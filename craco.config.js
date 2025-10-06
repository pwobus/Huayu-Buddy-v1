
// File: craco.config.js  (if you use CRACO start/build scripts)
const path = require('path');
module.exports = {
  webpack: {
    alias: {
      'three-mesh-bvh': path.resolve(__dirname, 'src/shims/three-mesh-bvh.js'),
    },
  },
};