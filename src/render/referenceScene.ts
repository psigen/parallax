import {
  AmbientLight,
  BoxGeometry,
  CylinderGeometry,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';

/**
 * A diagnostic scene with markers at known depths, in the screen frame (metres), for judging
 * parallax against physical objects in the room: post pairs at 0.3 m, 1 m, 3 m, 10 m and 30 m
 * behind the glass, each scaled so that from the rest distance straight ahead they all overlap
 * on screen; moving the head fans them out by depth. Plus a ground grid and a sphere 0.1 m in
 * front of the glass. Select with `?scene=reference`.
 */
export function buildReferenceScene(restDistanceM = 0.55): Group {
  const g = new Group();
  g.name = 'reference';
  const depths: [number, number][] = [
    [0.3, 0xe74c3c],
    [1, 0xf39c12],
    [3, 0x2ecc71],
    [10, 0x3498db],
    [30, 0x9b59b6],
  ];
  for (const [d, color] of depths) {
    const mat = new MeshStandardMaterial({ color, roughness: 0.6 });
    // Scale with distance from the rest eye so every marker subtends the same angle from there.
    const s = (restDistanceM + d) / restDistanceM;
    const h = 0.16 * s;
    const r = 0.004 * s;
    for (const side of [-1, 1]) {
      const post = new Mesh(new CylinderGeometry(r, r, h, 16), mat);
      post.position.set(side * 0.08 * s, 0, -d);
      g.add(post);
    }
    const bar = new Mesh(new BoxGeometry(0.16 * s, r * 2, r * 2), mat);
    bar.position.set(0, 0.06 * s, -d);
    g.add(bar);
  }
  const grid = new GridHelper(80, 80, 0x666666, 0x333333);
  grid.position.y = -0.25;
  g.add(grid);
  const near = new Mesh(
    new SphereGeometry(0.015, 24, 16),
    new MeshStandardMaterial({ color: 0xf1c40f, roughness: 0.3 }),
  );
  near.position.set(-0.05, 0.05, 0.1);
  g.add(near);
  const sun = new DirectionalLight(0xffffff, 2.5);
  sun.position.set(0.3, 1, 0.8);
  g.add(sun, sun.target, new AmbientLight(0xffffff, 0.6));
  return g;
}
