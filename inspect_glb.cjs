const fs = require('fs');
const { GLTFLoader } = require('three/examples/jsm/loaders/GLTFLoader.js');
// wait, can't easily run GLTFLoader in node without headless setup.
// Let's use a quick python script or just parse it with a node gltf library, OR I can just run it in the browser!
// Actually, it's easier to just write a simple Node script that parses the JSON chunk of the GLB.
const buffer = fs.readFileSync('public/openable_pokeball.glb');
const magic = buffer.toString('utf8', 0, 4);
if (magic !== 'glTF') throw new Error('Not a GLB');
const jsonChunkLength = buffer.readUInt32LE(12);
const jsonChunkType = buffer.toString('utf8', 16, 20);
if (jsonChunkType !== 'JSON') throw new Error('First chunk not JSON');
const jsonStr = buffer.toString('utf8', 20, 20 + jsonChunkLength);
const gltf = JSON.parse(jsonStr);
console.log(JSON.stringify(gltf.nodes.map((n, i) => ({ id: i, name: n.name, children: n.children })), null, 2));
if (gltf.animations) {
    console.log("Animations:", gltf.animations.map(a => a.name));
}
