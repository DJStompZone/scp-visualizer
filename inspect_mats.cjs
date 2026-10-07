const fs = require('fs');
const buffer = fs.readFileSync('public/openable_pokeball.glb');
const jsonChunkLength = buffer.readUInt32LE(12);
const jsonStr = buffer.toString('utf8', 20, 20 + jsonChunkLength);
const gltf = JSON.parse(jsonStr);
gltf.nodes.forEach(n => {
    if (n.mesh !== undefined) {
        const mesh = gltf.meshes[n.mesh];
        const mat = gltf.materials[mesh.primitives[0].material];
        console.log(`Node: ${n.name}, Mesh: ${mesh.name}, Material: ${mat ? mat.name : 'none'}`);
    }
});
