

# About

This project builds upon Potree — an open-source WebGL-based point cloud renderer originally created by Markus Schütz.

Potree has played a key role in making large-scale 3D point cloud visualization accessible on the web, and it remains a highly valuable foundation for further development.
This fork continues that legacy with the goal of simplifying integration of new features, updating parts of the codebase for modern web technologies, and providing a basis for ongoing experimentation and improvement.

For more information about the original Potree project, its background, and motivation, please visit:
👉 https://potree.org
    
# Getting Started

### Install on your PC

Install [node.js](http://nodejs.org/)

Install dependencies, as specified in package.json, and create a build in ./build/potree.

```bash
npm install
```

### Run on your PC

Use the `npm start` command to 

* create ./build/potree 
* watch for changes to the source code and automatically create a new build on change
* start a web server at localhost:1234. 

Go to http://localhost:1234/examples/ to test the examples.

### Deploy to a server

* Simply upload the Potree folderm with all your point clouds, the build directory, and your html files to a web server.
* It is not required to install node.js on your webserver. All you need is to host your files online. 
