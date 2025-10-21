/*! ******************************************************************************************************** *
 *
 * Copyright 2011-2020 Markus Schütz
 * Copyright 2025 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

const path = require("path");
const gulp = require("gulp");
const del = require("del");
const exec = require("child_process").exec;

const fs = require("fs");
const fsp = fs.promises;
const concat = require("gulp-concat");
const merge = require("merge-stream");
const connect = require("gulp-connect");
const {watch} = gulp;

const {createExamplesPage} = require("./src/tools/create_potree_page");
const {createGithubPage} = require("./src/tools/create_github_page");
const {createIconsPage} = require("./src/tools/create_icons_page");
const archiver = require("archiver");

let paths = {
    laslaz: [
        "build/workers/laslaz-worker.js",
        "build/workers/lasdecoder-worker.js",
    ],
    html: [
        "src/viewer/potree.css",
        "src/viewer/sidebar.html",
        "src/viewer/profile.html"
    ],
    resources: [
        "resources/**/*"
    ]
};

let workers = {
    "LASLAZWorker": [
        "libs/plasio/workers/laz-perf.js",
        "libs/plasio/workers/laz-loader-worker.js"
    ],
    "LASDecoderWorker": [
        "src/workers/LASDecoderWorker.js"
    ],
    "EptLaszipDecoderWorker": [
        "libs/copc/index.js",
        "src/workers/EptLaszipDecoderWorker.js",
    ],
    "EptBinaryDecoderWorker": [
        "libs/ept/ParseBuffer.js",
        "src/workers/EptBinaryDecoderWorker.js"
    ],
    "EptZstandardDecoderWorker": [
        "src/workers/EptZstandardDecoder_preamble.js",
        "libs/zstd-codec/bundle.js",
        "libs/ept/ParseBuffer.js",
        "src/workers/EptZstandardDecoderWorker.js"
    ]
};

// these libs are lazily loaded
// in order for the lazy loader to find them, independent of the path of the html file,
// we package them together with potree
let lazyLibs = {
    "geopackage": "libs/geopackage",
    "sql.js": "libs/sql.js"
};

let shaders = [
    "src/materials/shaders/pointcloud.vs",
    "src/materials/shaders/pointcloud.fs",
    "src/materials/shaders/pointcloud_sm.vs",
    "src/materials/shaders/pointcloud_sm.fs",
    "src/materials/shaders/normalize.vs",
    "src/materials/shaders/normalize.fs",
    "src/materials/shaders/normalize_and_edl.fs",
    "src/materials/shaders/edl.vs",
    "src/materials/shaders/edl.fs",
    "src/materials/shaders/blur.vs",
    "src/materials/shaders/blur.fs",
];

let assets = ["build/potree", "build/shaders", "pointclouds", "libs", "examples", "docs", "LICENSE", "README.md"];

// For development, it is now possible to use 'gulp webserver'
// from the command line to start the server (default port is 8080)
gulp.task("clean", async () => {
    return del.deleteAsync(["build"]);
});

gulp.task("archive", async () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
    const outDir = path.dirname("build");
    fs.mkdirSync(outDir, {recursive: true});

    const baseName = `Potree-${pkg.version.replace(/\./gm, "-")}`;
    const output = fs.createWriteStream(`build/${baseName}.zip`);
    const archive = archiver("zip", {zlib: {level: 9}});

    output.on("close", () => {
        console.log("archive " + output.path + " constructed");
    });
    output.on("end", () => {
        console.log("finished");
    });
    archive.on("warning", (err) => {
        if (err.code !== "ENOENT") {
            throw err;
        }
    });
    archive.on("error", (err) => {
        throw err;
    });
    archive.pipe(output);
    for (const asset of assets) {
        if (fs.existsSync(asset)) {
            if (fs.statSync(asset).isDirectory()) {
                archive.directory(asset, `${baseName}/${asset}`, null);
            } else {
                const name = path.basename(asset);
                archive.file(asset, {name: `${baseName}/${name}`});
            }
        }
    }
    return archive.finalize();
});

gulp.task("webserver", gulp.series(async function () {
    server = connect.server({
        port: 1234,
        https: false,
    });
}));

gulp.task("examples_page", async () => {
    await Promise.all([
        createExamplesPage(),
        createGithubPage(),
    ]);
});

gulp.task("icons_viewer", async () => {
    await createIconsPage();
});

gulp.task("test", async () => {
    console.log("asdfiae8ofh");
});

gulp.task("workers", function () {
    const workerStreams = Object.keys(workers).map(workerName => {
        return gulp.src(workers[workerName])
            .pipe(concat(`${workerName}.js`))
            .pipe(gulp.dest("build/potree/workers"));
    });

    const wasmStream = gulp.src("./libs/copc/laz-perf.wasm", {encoding: false})
        .pipe(gulp.dest("./build/potree/workers"));

    return merge(...workerStreams, wasmStream);
});

gulp.task("lazylibs", async () => {
    for (let libname of Object.keys(lazyLibs)) {
        const libpath = lazyLibs[libname];

        gulp.src([`${libpath}/**/*`])
            .pipe(gulp.dest(`build/potree/lazylibs/${libname}`));
    }
});

gulp.task("shaders", async () => {
    const components = [
        "let Shaders = {};"
    ];

    for (let file of shaders) {
        const filename = path.basename(file);

        const content = await fsp.readFile(file);

        const prep = `Shaders["${filename}"] = \`${content}\``;

        components.push(prep);
    }

    components.push("export {Shaders};");

    const content = components.join("\n\n");

    const targetPath = `./build/shaders/shaders.js`;

    if (!fs.existsSync("build/shaders")) {
        fs.mkdirSync("build/shaders");
    }
    fs.writeFileSync(targetPath, content, {flag: "w"});
});

gulp.task("pack", async () => {
    return new Promise((resolve, reject) => {
        exec("rollup -c", (err, stdout, stderr) => {
            console.log(stdout);
            console.error(stderr);

            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
});

gulp.task("pack-min", async () => {
    return new Promise((resolve, reject) => {
        exec("rollup -c rollup.distro.mjs", (err, stdout, stderr) => {
            console.log(stdout);
            console.error(stderr);

            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
});

gulp.task("build",
    gulp.series(
        gulp.parallel("workers", "lazylibs", "shaders", "icons_viewer", "examples_page"),
        async () => {
            gulp.src(paths.html).pipe(gulp.dest("build/potree"));

            gulp.src(paths.resources).pipe(gulp.dest("build/potree/resources"));

            gulp.src(["LICENSE"]).pipe(gulp.dest("build/potree"));
        }
    )
);

gulp.task("release",
    gulp.series(
        "clean",
        "build",
        "pack-min",
        "archive"
    )
);

gulp.task("watch", gulp.parallel("build", "pack", "webserver", async () => {
    let watchlist = [
        "src/**/*.js",
        "src/**/**/*.js",
        "src/**/*.css",
        "src/**/*.html",
        "src/**/*.vs",
        "src/**/*.fs",
        "resources/**/*",
        "examples//**/*.json",
        "!resources/icons/index.html",
    ];

    watch(watchlist, gulp.series("build", "pack"));
}));
