/**
 * Generates public/scenes/room.glb: a box the size of the laptop display, attached to the back
 * of the screen, with size references at round dimensions so the rendering can be judged
 * against a ruler.
 *
 * Box interior: 300 mm wide x 200 mm high x 300 mm deep (the 14-inch display is 302.4 x 196.4),
 * 50 mm checkerboard tiles (6 x 4 on the back wall, 6 deep). A 20 mm frame lies in the glass
 * plane around the opening so the 1-2 mm mismatch with the display never shows as a gap.
 * References: 100 mm cube, 50 mm cube, 20 mm sphere, 10 mm post 200 mm tall, a 20 mm sphere
 * 50 mm in front of the glass.
 *
 * Authoring frame (deliberately NOT the screen frame, to exercise the `window` camera node):
 * origin on the floor, centred under the window opening, at the window plane. +y up, +z toward
 * the viewer. The `window` camera sits at (0, OPENING_H / 2, 0) looking down −z, which the app
 * uses to re-root the scene so the display centre becomes the world origin.
 *
 * Units: metres. Run with `npm run build:room`.
 */
import { Document, NodeIO, type Material, type Node, type Scene } from '@gltf-transform/core';
import { KHRLightsPunctual } from '@gltf-transform/extensions';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OPENING_W = 0.3;
const OPENING_H = 0.2;
const DEPTH = 0.3;
const TILE = 0.05;
const FRAME_W = 0.02;

type V3 = [number, number, number];

interface MeshData {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}

function emptyMesh(): MeshData {
  return { positions: [], normals: [], colors: [], indices: [] };
}

function addQuad(m: MeshData, a: V3, b: V3, c: V3, d: V3, n: V3, color: V3): void {
  const base = m.positions.length / 3;
  for (const p of [a, b, c, d]) {
    m.positions.push(...p);
    m.normals.push(...n);
    m.colors.push(...color);
  }
  m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * A wall as a checkerboard of flat-coloured tiles. `origin` is the tile-grid corner, `u`/`v`
 * the in-plane unit directions (u × v = outward-facing normal), `uLen`/`vLen` the extents.
 */
function addCheckerWall(
  m: MeshData,
  origin: V3,
  u: V3,
  v: V3,
  uLen: number,
  vLen: number,
  colorA: V3,
  colorB: V3,
): void {
  const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const nu = Math.round(uLen / TILE);
  const nv = Math.round(vLen / TILE);
  const at = (i: number, j: number): V3 => [
    origin[0] + u[0] * i * TILE + v[0] * j * TILE,
    origin[1] + u[1] * i * TILE + v[1] * j * TILE,
    origin[2] + u[2] * i * TILE + v[2] * j * TILE,
  ];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const color = (i + j) % 2 === 0 ? colorA : colorB;
      addQuad(m, at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1), n, color);
    }
  }
}

function addBox(m: MeshData, c: V3, size: V3, color: V3, yawRad = 0): void {
  const [sx, sy, sz] = [size[0] / 2, size[1] / 2, size[2] / 2];
  const cy = Math.cos(yawRad);
  const sn = Math.sin(yawRad);
  const r = (p: V3): V3 => [
    c[0] + p[0] * cy + p[2] * sn,
    c[1] + p[1],
    c[2] - p[0] * sn + p[2] * cy,
  ];
  const rn = (p: V3): V3 => [p[0] * cy + p[2] * sn, p[1], -p[0] * sn + p[2] * cy];
  const faces: { n: V3; q: V3[] }[] = [
    {
      n: [0, 0, 1],
      q: [
        [-sx, -sy, sz],
        [sx, -sy, sz],
        [sx, sy, sz],
        [-sx, sy, sz],
      ],
    },
    {
      n: [0, 0, -1],
      q: [
        [sx, -sy, -sz],
        [-sx, -sy, -sz],
        [-sx, sy, -sz],
        [sx, sy, -sz],
      ],
    },
    {
      n: [1, 0, 0],
      q: [
        [sx, -sy, sz],
        [sx, -sy, -sz],
        [sx, sy, -sz],
        [sx, sy, sz],
      ],
    },
    {
      n: [-1, 0, 0],
      q: [
        [-sx, -sy, -sz],
        [-sx, -sy, sz],
        [-sx, sy, sz],
        [-sx, sy, -sz],
      ],
    },
    {
      n: [0, 1, 0],
      q: [
        [-sx, sy, sz],
        [sx, sy, sz],
        [sx, sy, -sz],
        [-sx, sy, -sz],
      ],
    },
    {
      n: [0, -1, 0],
      q: [
        [-sx, -sy, -sz],
        [sx, -sy, -sz],
        [sx, -sy, sz],
        [-sx, -sy, sz],
      ],
    },
  ];
  for (const f of faces) {
    const [a, b, cc, d] = f.q as [V3, V3, V3, V3];
    addQuad(m, r(a), r(b), r(cc), r(d), rn(f.n), color);
  }
}

function addSphere(m: MeshData, c: V3, radius: number, color: V3, segments = 24): void {
  const base = m.positions.length / 3;
  const rings = Math.ceil(segments / 2);
  for (let j = 0; j <= rings; j++) {
    const phi = (j / rings) * Math.PI;
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const n: V3 = [
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      ];
      m.positions.push(c[0] + n[0] * radius, c[1] + n[1] * radius, c[2] + n[2] * radius);
      m.normals.push(...n);
      m.colors.push(...color);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      const a = base + j * (segments + 1) + i;
      const b = a + segments + 1;
      m.indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
}

function addCylinder(
  m: MeshData,
  c: V3,
  radius: number,
  height: number,
  color: V3,
  segments = 24,
): void {
  const base = m.positions.length / 3;
  for (const y of [c[1] - height / 2, c[1] + height / 2]) {
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const n: V3 = [Math.cos(theta), 0, Math.sin(theta)];
      m.positions.push(c[0] + n[0] * radius, y, c[2] + n[2] * radius);
      m.normals.push(...n);
      m.colors.push(...color);
    }
  }
  for (let i = 0; i < segments; i++) {
    const a = base + i;
    const b = a + segments + 1;
    m.indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  // caps
  for (const [y, ny] of [
    [c[1] + height / 2, 1],
    [c[1] - height / 2, -1],
  ] as [number, number][]) {
    const centre = m.positions.length / 3;
    m.positions.push(c[0], y, c[2]);
    m.normals.push(0, ny, 0);
    m.colors.push(...color);
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      m.positions.push(c[0] + Math.cos(theta) * radius, y, c[2] + Math.sin(theta) * radius);
      m.normals.push(0, ny, 0);
      m.colors.push(...color);
    }
    for (let i = 0; i < segments; i++) {
      if (ny > 0) m.indices.push(centre, centre + 1 + i + 1, centre + 1 + i);
      else m.indices.push(centre, centre + 1 + i, centre + 1 + i + 1);
    }
  }
}

function addMeshNode(
  doc: Document,
  scene: Scene,
  name: string,
  data: MeshData,
  material: Material,
): Node {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const prim = doc
    .createPrimitive()
    .setAttribute(
      'POSITION',
      doc
        .createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array(data.positions))
        .setBuffer(buffer),
    )
    .setAttribute(
      'NORMAL',
      doc
        .createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array(data.normals))
        .setBuffer(buffer),
    )
    .setAttribute(
      'COLOR_0',
      doc
        .createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array(data.colors))
        .setBuffer(buffer),
    )
    .setIndices(
      doc
        .createAccessor()
        .setType('SCALAR')
        .setArray(new Uint32Array(data.indices))
        .setBuffer(buffer),
    )
    .setMaterial(material);
  const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim));
  scene.addChild(node);
  return node;
}

async function build(): Promise<void> {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene('room');
  doc.getRoot().setDefaultScene(scene);

  const matte = doc
    .createMaterial('matte')
    .setBaseColorFactor([1, 1, 1, 1])
    .setRoughnessFactor(0.85)
    .setMetallicFactor(0);
  const glossy = doc
    .createMaterial('glossy')
    .setBaseColorFactor([1, 1, 1, 1])
    .setRoughnessFactor(0.35)
    .setMetallicFactor(0);

  const hw = OPENING_W / 2;
  const light: V3 = [0.82, 0.8, 0.76];
  const dark: V3 = [0.42, 0.44, 0.5];
  const room = emptyMesh();
  // Back wall (faces +z toward the viewer).
  addCheckerWall(room, [-hw, 0, -DEPTH], [1, 0, 0], [0, 1, 0], OPENING_W, OPENING_H, light, dark);
  // Floor (faces up): u = +x, v = -z so u × v = +y.
  addCheckerWall(room, [-hw, 0, 0], [1, 0, 0], [0, 0, -1], OPENING_W, DEPTH, light, dark);
  // Ceiling (faces down): u = +x, v = +z so u × v = -y.
  addCheckerWall(
    room,
    [-hw, OPENING_H, -DEPTH],
    [1, 0, 0],
    [0, 0, 1],
    OPENING_W,
    DEPTH,
    light,
    dark,
  );
  // Left wall (faces +x): u = +z... origin at back-bottom, u = +z, v = +y gives (0,0,1)×(0,1,0) = (-1,0,0); use u = +y, v = +z.
  addCheckerWall(room, [-hw, 0, -DEPTH], [0, 1, 0], [0, 0, 1], OPENING_H, DEPTH, light, dark);
  // Right wall (faces -x): u = +z, v = +y gives (0,0,1)×(0,1,0) = (-1,0,0).
  addCheckerWall(room, [hw, 0, -DEPTH], [0, 0, 1], [0, 1, 0], DEPTH, OPENING_H, light, dark);
  addMeshNode(doc, scene, 'room', room, matte);

  // Window frame in the glass plane (z = 0), facing the viewer, 20 mm wide around the opening.
  const frame = emptyMesh();
  const fo = FRAME_W;
  const frameColor: V3 = [0.12, 0.12, 0.13];
  addQuad(
    frame,
    [-hw - fo, -fo, 0],
    [hw + fo, -fo, 0],
    [hw + fo, 0, 0],
    [-hw - fo, 0, 0],
    [0, 0, 1],
    frameColor,
  );
  addQuad(
    frame,
    [-hw - fo, OPENING_H, 0],
    [hw + fo, OPENING_H, 0],
    [hw + fo, OPENING_H + fo, 0],
    [-hw - fo, OPENING_H + fo, 0],
    [0, 0, 1],
    frameColor,
  );
  addQuad(
    frame,
    [-hw - fo, 0, 0],
    [-hw, 0, 0],
    [-hw, OPENING_H, 0],
    [-hw - fo, OPENING_H, 0],
    [0, 0, 1],
    frameColor,
  );
  addQuad(
    frame,
    [hw, 0, 0],
    [hw + fo, 0, 0],
    [hw + fo, OPENING_H, 0],
    [hw, OPENING_H, 0],
    [0, 0, 1],
    frameColor,
  );
  addMeshNode(doc, scene, 'frame', frame, matte);

  // Size references (all round numbers, axis-aligned).
  const objects = emptyMesh();
  // 100 mm cube on the floor in the back-left corner (x -150..-50, z -300..-200).
  addBox(objects, [-0.1, 0.05, -0.25], [0.1, 0.1, 0.1], [0.2, 0.4, 0.95]);
  // 50 mm cube on the floor, right, mid-depth (x 75..125, z -125..-75).
  addBox(objects, [0.1, 0.025, -0.1], [0.05, 0.05, 0.05], [0.9, 0.2, 0.15]);
  // 20 mm sphere floating at the box centre height, 150 mm deep.
  addSphere(objects, [0, OPENING_H / 2, -0.15], 0.01, [0.2, 0.8, 0.3]);
  // 10 mm post, floor to ceiling, 100 mm deep, 50 mm right of centre.
  addCylinder(objects, [0.05, OPENING_H / 2, -0.1], 0.005, OPENING_H, [0.9, 0.85, 0.7]);
  // 20 mm sphere 50 mm in front of the glass (protrudes toward the viewer).
  addSphere(objects, [-0.06, OPENING_H / 2 + 0.05, 0.05], 0.01, [1, 0.85, 0.1]);
  addMeshNode(doc, scene, 'objects', objects, glossy);

  // The window: a camera at the opening's centre looking into the room (−z).
  const windowCam = doc
    .createCamera('window')
    .setType('perspective')
    .setYFov(0.8)
    .setAspectRatio(OPENING_W / OPENING_H)
    .setZNear(0.01)
    .setZFar(50);
  scene.addChild(
    doc
      .createNode('window')
      .setCamera(windowCam)
      .setTranslation([0, OPENING_H / 2, 0]),
  );

  const lightsExt = doc.createExtension(KHRLightsPunctual);
  const addPoint = (name: string, pos: V3, intensity: number, color: V3) => {
    const l = lightsExt.createLight(name).setType('point').setIntensity(intensity).setColor(color);
    scene.addChild(doc.createNode(name).setTranslation(pos).setExtension('KHR_lights_punctual', l));
  };
  addPoint('lamp-left', [-0.1, OPENING_H - 0.03, -0.1], 0.06, [1, 0.95, 0.85]);
  addPoint('lamp-right', [0.1, OPENING_H - 0.03, -0.25], 0.04, [0.85, 0.9, 1]);
  // Soft fill from the viewer's side so content in front of the window is not lit only from behind.
  // glTF directional lights point down their node's -z; aim this one into the room, slightly down.
  const fill = lightsExt
    .createLight('fill')
    .setType('directional')
    .setIntensity(1.2)
    .setColor([1, 1, 1]);
  scene.addChild(
    doc
      .createNode('fill')
      .setTranslation([0, OPENING_H, 0.3])
      .setRotation([-Math.sin(0.15), 0, 0, Math.cos(0.15)])
      .setExtension('KHR_lights_punctual', fill),
  );

  const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/scenes/room.glb');
  mkdirSync(dirname(out), { recursive: true });
  const io = new NodeIO().registerExtensions([KHRLightsPunctual]);
  await io.write(out, doc);
  console.log(`wrote ${out}`);
}

await build();
