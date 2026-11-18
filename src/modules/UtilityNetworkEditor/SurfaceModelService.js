/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

const SURFACE_EXPORT_URL = "https://ags.cuzk.gov.cz/arcgis2/rest/services/dmp/ImageServer/exportImage";
const TERRAIN_EXPORT_URL = "https://ags.cuzk.gov.cz/arcgis2/rest/services/dmr5g/ImageServer/exportImage";
const ORTHOPHOTO_EXPORT_URL = "https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO/MapServer/export";
const MINIMUM_CELL_METRES = 0.5;
const CELL_STEP_METRES = 0.25;
const MAXIMUM_RASTER_PIXELS = 2100;
const MAXIMUM_TILE_PIXELS = 1000;
const LITTLE_ENDIAN_MARK = 0x4949;
const TIFF_SHORT_TYPE = 3;
const TIFF_LONG_TYPE = 4;
const TiffTag = Object.freeze({
    IMAGE_WIDTH: 256,
    IMAGE_LENGTH: 257,
    BITS_PER_SAMPLE: 258,
    COMPRESSION: 259,
    STRIP_OFFSETS: 273,
    SAMPLES_PER_PIXEL: 277,
    ROWS_PER_STRIP: 278,
    TILE_WIDTH: 322,
    TILE_LENGTH: 323,
    TILE_OFFSETS: 324,
    SAMPLE_FORMAT: 339
});
const FLOAT_SAMPLE_FORMAT = 3;
const NO_COMPRESSION = 1;

function readTiffTags(view, isLittleEndian) {
    const tags = new Map();
    const directoryOffset = view.getUint32(4, isLittleEndian);
    const entryCount = view.getUint16(directoryOffset, isLittleEndian);
    for (let entryIndex = 0; entryIndex < entryCount; entryIndex++) {
        const entry = directoryOffset + 2 + entryIndex * 12;
        const type = view.getUint16(entry + 2, isLittleEndian);
        if (type !== TIFF_SHORT_TYPE && type !== TIFF_LONG_TYPE) {
            continue;
        }
        const count = view.getUint32(entry + 4, isLittleEndian);
        const valueSize = type === TIFF_SHORT_TYPE ? 2 : 4;
        const valuesOffset = count * valueSize <= 4 ? entry + 8 : view.getUint32(entry + 8, isLittleEndian);
        const values = [];
        for (let valueIndex = 0; valueIndex < count; valueIndex++) {
            const offset = valuesOffset + valueIndex * valueSize;
            values.push(type === TIFF_SHORT_TYPE ? view.getUint16(offset, isLittleEndian) : view.getUint32(offset, isLittleEndian));
        }
        tags.set(view.getUint16(entry, isLittleEndian), values);
    }
    return tags;
}

function copyBlock(view, isLittleEndian, values, block) {
    for (let row = 0; row < block.height && block.top + row < block.imageHeight; row++) {
        for (let column = 0; column < block.width && block.left + column < block.imageWidth; column++) {
            values[(block.top + row) * block.imageWidth + block.left + column] = view.getFloat32(block.offset + (row * block.width + column) * 4, isLittleEndian);
        }
    }
}

export function readFloatTiff(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const isLittleEndian = view.getUint16(0, false) === LITTLE_ENDIAN_MARK;
    const tags = readTiffTags(view, isLittleEndian);
    const tagValue = (tag, fallback) => tags.get(tag)?.[0] ?? fallback;
    const width = tagValue(TiffTag.IMAGE_WIDTH);
    const height = tagValue(TiffTag.IMAGE_LENGTH);
    const isSupported = tagValue(TiffTag.BITS_PER_SAMPLE) === 32 && tagValue(TiffTag.COMPRESSION, NO_COMPRESSION) === NO_COMPRESSION
        && tagValue(TiffTag.SAMPLES_PER_PIXEL, 1) === 1 && tagValue(TiffTag.SAMPLE_FORMAT) === FLOAT_SAMPLE_FORMAT;
    if (!width || !height || !isSupported) {
        throw new Error("Unsupported elevation raster");
    }
    const values = new Float32Array(width * height);
    if (tags.has(TiffTag.TILE_OFFSETS)) {
        const tileWidth = tagValue(TiffTag.TILE_WIDTH);
        const tileLength = tagValue(TiffTag.TILE_LENGTH);
        const tilesAcross = Math.ceil(width / tileWidth);
        tags.get(TiffTag.TILE_OFFSETS).forEach((offset, tileIndex) => copyBlock(view, isLittleEndian, values, {
            offset: offset,
            left: (tileIndex % tilesAcross) * tileWidth,
            top: Math.floor(tileIndex / tilesAcross) * tileLength,
            width: tileWidth,
            height: tileLength,
            imageWidth: width,
            imageHeight: height
        }));
    } else {
        const rowsPerStrip = tagValue(TiffTag.ROWS_PER_STRIP, height);
        tags.get(TiffTag.STRIP_OFFSETS).forEach((offset, stripIndex) => copyBlock(view, isLittleEndian, values, {
            offset: offset,
            left: 0,
            top: stripIndex * rowsPerStrip,
            width: width,
            height: rowsPerStrip,
            imageWidth: width,
            imageHeight: height
        }));
    }
    return { width: width, height: height, values: values };
}

function createExportUrl(url, extent, width, height, parameters) {
    const query = new URLSearchParams({
        bbox: [extent.minimumX, extent.minimumY, extent.maximumX, extent.maximumY].map((value) => value.toFixed(2)).join(","),
        bboxSR: "5514",
        imageSR: "5514",
        size: `${width},${height}`,
        f: "image",
        ...parameters
    });
    return `${url}?${query.toString()}`;
}

function createTileExtent(grid, tile) {
    const minimumX = grid.minimumX + tile.column * grid.cellSize;
    const maximumY = grid.maximumY - tile.row * grid.cellSize;
    return { minimumX: minimumX, maximumX: minimumX + tile.width * grid.cellSize, maximumY: maximumY, minimumY: maximumY - tile.height * grid.cellSize };
}

async function fetchHeightTile(url, extent, width, height) {
    const response = await fetch(createExportUrl(url, extent, width, height, { format: "tiff", pixelType: "F32", interpolation: "RSP_BilinearInterpolation" }));
    if (!response.ok) {
        throw new Error(`Elevation request failed with status ${response.status}`);
    }
    const raster = readFloatTiff(await response.arrayBuffer());
    if (raster.width !== width || raster.height !== height) {
        throw new Error("Unexpected elevation raster size");
    }
    return raster.values;
}

async function fetchHeights(url, grid) {
    const values = new Float32Array(grid.width * grid.height);
    const tiles = [];
    for (let row = 0; row < grid.height; row += MAXIMUM_TILE_PIXELS) {
        for (let column = 0; column < grid.width; column += MAXIMUM_TILE_PIXELS) {
            tiles.push({ column: column, row: row, width: Math.min(MAXIMUM_TILE_PIXELS, grid.width - column), height: Math.min(MAXIMUM_TILE_PIXELS, grid.height - row) });
        }
    }
    await Promise.all(tiles.map(async (tile) => {
        const tileValues = await fetchHeightTile(url, createTileExtent(grid, tile), tile.width, tile.height);
        for (let row = 0; row < tile.height; row++) {
            values.set(tileValues.subarray(row * tile.width, (row + 1) * tile.width), (tile.row + row) * grid.width + tile.column);
        }
    }));
    return values;
}

async function fetchOrthophotoColors(grid) {
    const extent = createTileExtent(grid, { column: 0, row: 0, width: grid.width, height: grid.height });
    const response = await fetch(createExportUrl(ORTHOPHOTO_EXPORT_URL, extent, grid.width, grid.height, { format: "jpg" }));
    if (!response.ok) {
        throw new Error(`Orthophoto request failed with status ${response.status}`);
    }
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(grid.width, grid.height);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0, grid.width, grid.height);
    bitmap.close();
    return context.getImageData(0, 0, grid.width, grid.height).data;
}

export function createSurfaceGrid(extent) {
    const size = Math.max(extent.maximumX - extent.minimumX, extent.maximumY - extent.minimumY);
    const cellSize = Math.max(MINIMUM_CELL_METRES, Math.ceil(size / MAXIMUM_RASTER_PIXELS / CELL_STEP_METRES) * CELL_STEP_METRES);
    const minimumX = Math.floor(extent.minimumX / cellSize) * cellSize;
    const minimumY = Math.floor(extent.minimumY / cellSize) * cellSize;
    const maximumX = Math.ceil(extent.maximumX / cellSize) * cellSize;
    const maximumY = Math.ceil(extent.maximumY / cellSize) * cellSize;
    return {
        minimumX: minimumX,
        maximumY: maximumY,
        cellSize: cellSize,
        width: Math.max(1, Math.round((maximumX - minimumX) / cellSize)),
        height: Math.max(1, Math.round((maximumY - minimumY) / cellSize))
    };
}

export async function fetchSurfaceRaster(extent) {
    const grid = createSurfaceGrid(extent);
    const [surfaceHeights, terrainHeights, colors] = await Promise.all([
        fetchHeights(SURFACE_EXPORT_URL, grid),
        fetchHeights(TERRAIN_EXPORT_URL, grid),
        fetchOrthophotoColors(grid)
    ]);
    return { ...grid, surfaceHeights: surfaceHeights, terrainHeights: terrainHeights, colors: colors };
}
