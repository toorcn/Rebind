import * as THREE from 'three';

export function mountScene(root, initial) {
  const mount = root.querySelector('.sv-scene');
  const fallback = root.querySelector('.sv-fallback');
  const labels = new Map([...root.querySelectorAll('[data-label]')].map(el => [el.dataset.label, el]));
  let model = initial;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  mount.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-4.8, 4.8, 2.5, -2.5, 0.1, 60);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7968, 2.4));
  const sun = new THREE.DirectionalLight(0xfff0d9, 4);
  sun.position.set(-3, 7, 5); sun.castShadow = true;
  sun.shadow.mapSize.set(1024,1024); sun.shadow.camera.left = -5; sun.shadow.camera.right = 5; sun.shadow.camera.top = 5; sun.shadow.camera.bottom = -5;
  sun.shadow.normalBias = .025; sun.shadow.bias = -.0001; sun.shadow.radius = 4;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xd4e4ff, 1.5); fill.position.set(4,3,-4); scene.add(fill);
  const materials = {};
  function mat(name,color,metalness=0) { materials[name] = new THREE.MeshStandardMaterial({ color, roughness: .43, metalness }); return materials[name]; }
  const boardMat = mat('board',0xe8eaf8), edgeMat = mat('edge',0xf7f8ff), humanMat = mat('human',0x5869eb), humanBMat = mat('humanB',0x2a3a6e), agentMat = mat('agent',0xe2e5f7), faceMat = mat('face',0x25355e), eyeMat = mat('eye',0xe9eadb), vaultMat = mat('vault',0x6376b5), doorMat = mat('door',0xa0abe0), coinMat = mat('coin',0xd9ddee,.58), wireMat = mat('wire',0x8f9bd6), wireBMat = mat('wireB',0x8299b0), darkMat = mat('dark',0x33436d), trackMat = mat('track',0xbac2df);
  function mesh(geo, material, parent, x=0,y=0,z=0) { const o = new THREE.Mesh(geo,material); o.position.set(x,y,z); o.castShadow=true; o.receiveShadow=true; parent.add(o); return o; }
  function box(w,h,d,r,material,parent,x=0,y=0,z=0) {
    const s = new THREE.Shape(), a=w/2-r, b=h/2-r, c=Math.min(r,.08);
    s.moveTo(-a+c,-b); s.lineTo(a-c,-b); s.quadraticCurveTo(a,-b,a,-b+c); s.lineTo(a,b-c); s.quadraticCurveTo(a,b,a-c,b); s.lineTo(-a+c,b); s.quadraticCurveTo(-a,b,-a,b-c); s.lineTo(-a,-b+c); s.quadraticCurveTo(-a,-b,-a+c,-b);
    const g = new THREE.ExtrudeGeometry(s,{depth:d-2*r,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:r,bevelThickness:r,curveSegments:6}); g.translate(0,0,-(d-2*r)/2);
    return mesh(g,material,parent,x,y,z);
  }
  const board = new THREE.Group(); scene.add(board);
  box(7.2,.18,4.6,.055,boardMat,board,0,-.15,0);
  function disc(parent,x,z,r,material) { return mesh(new THREE.CylinderGeometry(r,r,.07,64), material,parent,x,0,z); }
  function human(material,x) {
    const g = new THREE.Group(); g.position.set(x,0,-1.25); board.add(g);
    disc(g,0,0,.53,edgeMat);
    mesh(new THREE.CylinderGeometry(.19,.32,.57,40),material,g,0,.39,0);
    mesh(new THREE.SphereGeometry(.255,32,24),material,g,0,.92,0);
    return g;
  }
  const humanA=human(humanMat,0), humanB=human(humanBMat,2.15);
  function agent(x) {
    const g = new THREE.Group(); g.position.set(x,0,.9); board.add(g);
    disc(g,0,0,.64,edgeMat);
    box(.86,.69,.6,.09,agentMat,g,0,.47,0);
    box(.67,.3,.055,.02,faceMat,g,0,.48,.309);
    mesh(new THREE.SphereGeometry(.042,16,12),eyeMat,g,-.14,.5,.35);
    mesh(new THREE.SphereGeometry(.042,16,12),eyeMat,g,.14,.5,.35);
    mesh(new THREE.CylinderGeometry(.025,.025,.14,12),vaultMat,g,0,.91,0);
    mesh(new THREE.SphereGeometry(.055,16,12),coinMat,g,0,1.01,0);
    return g;
  }
  const buyer=agent(-2.15), worker=agent(2.15);
  const vault=new THREE.Group(); vault.position.set(0,0,.78); board.add(vault);
  disc(vault,0,0,.73,edgeMat);
  box(1.05,.91,.78,.075,vaultMat,vault,0,.55,0);
  box(.82,.7,.05,.02,darkMat,vault,0,.56,.401);
  const hinge=new THREE.Group(); hinge.position.set(-.43,.55,.44); vault.add(hinge);
  box(.86,.75,.095,.03,doorMat,hinge,.43,0,0);
  mesh(new THREE.TorusGeometry(.13,.025,12,32),darkMat,hinge,.43,0,.07);
  box(.04,.22,.03,.005,darkMat,hinge,.43,0,.075);
  box(.22,.04,.03,.005,darkMat,hinge,.43,0,.075);
  const coins=new THREE.Group(); coins.position.set(0,0,-.15); board.add(coins);
  for(let i=0;i<4;i++) mesh(new THREE.CylinderGeometry(.25,.25,.075,40),coinMat,coins,0,.15+i*.087,0);
  const route=new THREE.Group(); board.add(route);
  function tube(points,material,parent,r=.035) { const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))); return mesh(new THREE.TubeGeometry(curve,40,r,8,false),material,parent); }
  tube([[-2.15,.07,.9],[-1.25,.07,.9],[0,.07,.9],[1.25,.07,.9],[2.15,.07,.9]],trackMat,route,.025);
  const wires = new THREE.Group(); board.add(wires);
  let wireA,wireB;
  function setWires(x,separate) {
    [wireA,wireB].forEach(o=>{if(o){wires.remove(o);o.geometry.dispose();}});
    wireA=tube([[x,.12,-1.1],[x,.11,-.7],[-2.15,.11,-.35],[-2.15,.12,.48]],wireMat,wires);
    const other=separate?2.15:x;
    wireB=tube([[other,.12,-1.1],[other,.11,-.7],[2.15,.11,-.35],[2.15,.12,.48]],separate?wireBMat:wireMat,wires);
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let width = 0, height = 0, frame = 0, transition = null, lost = false;
  function target() {
    const people = model.mode === 'people', paid = model.phase === 'paid', refunded = model.phase === 'refunded';
    return { x: model.separate ? -2.15 : 0, b: model.separate ? 1 : 0, open: paid || refunded ? 1 : 0, coinX: paid ? 2.95 : refunded ? -2.95 : 0, coinY: paid || refunded ? .02 : 1.03, coinZ: paid || refunded ? .9 : .78, humanScale: people ? 1 : 0 };
  }
  let pose = target();
  function positionLabel(name, xyz, title, subtitle = '', visible = true) {
    const e = labels.get(name); e.hidden = !visible; if (!visible) return;
    if (e.dataset.title !== title || e.dataset.subtitle !== subtitle) {
      const b = document.createElement('b'); b.textContent = title; e.replaceChildren(b);
      if (subtitle) { const small = document.createElement('small'); small.textContent = subtitle; e.append(small); }
      e.dataset.title = title; e.dataset.subtitle = subtitle;
    }
    const p = new THREE.Vector3(...xyz).project(camera);
    e.style.left = ((p.x * .5 + .5) * width) + 'px'; e.style.top = ((-p.y * .5 + .5) * height) + 'px';
  }
  function paint() {
    if (!width || !height || lost || document.hidden) return;
    const people = model.mode === 'people', paid = model.phase === 'paid', refunded = model.phase === 'refunded';
    humanA.position.x = pose.x; humanA.scale.setScalar(pose.humanScale); humanA.visible = pose.humanScale > .01;
    humanB.scale.setScalar(Math.max(.001, pose.b * pose.humanScale)); humanB.visible = pose.b * pose.humanScale > .01;
    wires.visible = people;
    hinge.rotation.y = -pose.open * 1.65;
    coins.position.set(pose.coinX, pose.coinY, pose.coinZ);
    coins.visible = !people && !['empty', 'closed'].includes(model.phase);
    renderer.render(scene, camera);
    positionLabel('human-a', [pose.x, 1.45, -1.25], pose.x < -.5 ? 'Person A' : 'One person', '', people);
    positionLabel('human-b', [2.15, 1.45, -1.25], 'Person B', '', people && pose.b > .65);
    positionLabel('buyer', [-2.15, -.05, 1.73], people ? 'Buyer agent' : 'Buyer', people ? '' : model.buyer ? 'Verified' : 'Not verified');
    positionLabel('worker', [2.15, -.05, 1.73], people ? 'Worker agent' : 'Worker', people ? '' : model.worker ? 'Verified' : 'Not verified');
    const money = ['empty', 'paid', 'refunded'].includes(model.phase) ? '0' : model.phase === 'closed' ? '—' : model.amount;
    positionLabel('money', [0, people ? -.02 : 2.05, people ? 1.9 : .65], people ? 'Escrow' : money + ' ' + model.unit, people ? (model.separate ? 'Check passes' : 'Locked') : paid ? 'Released' : refunded ? 'Refunded' : model.phase === 'empty' ? 'Not funded' : model.phase === 'closed' ? 'Check status' : 'In escrow');
    positionLabel('received', [refunded ? -2.6 : 2.6, 1.55, .9], '+' + model.amount + ' ' + model.unit, '', !people && (paid || refunded));
    mount.setAttribute('aria-label', model.status + '. ' + model.detail);
  }
  function tick(t) {
    frame = 0;
    if (transition) {
      const p = Math.min(1, (t - transition.start) / 650), e = 1 - Math.pow(1 - p, 3);
      for (const k of Object.keys(pose)) pose[k] = transition.from[k] + (transition.to[k] - transition.from[k]) * e;
      if (model.mode === 'people') setWires(pose.x, model.separate);
      if (p === 1) transition = null;
    }
    paint(); if (transition && !document.hidden) frame = requestAnimationFrame(tick);
  }
  function resize() {
    width = mount.clientWidth; height = mount.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    const halfW = 4.2, halfH = halfW / (width / height);
    camera.left = -halfW; camera.right = halfW; camera.top = halfH; camera.bottom = -halfH;
    camera.position.set(0, 7.7, 10.8); camera.lookAt(0, .13, 0); camera.updateProjectionMatrix(); paint();
  }
  function update(next) {
    const sameJob = next.key === model.key;
    model = next;
    if (reduced.matches || !sameJob || document.hidden || !width) {
      pose = target(); transition = null; setWires(pose.x, model.separate); paint();
    } else {
      transition = { start: performance.now(), from: { ...pose }, to: target() };
      if (!frame) frame = requestAnimationFrame(tick);
    }
  }
  function visibility() { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; transition = null; pose = target(); } else { setWires(pose.x, model.separate); resize(); } }
  function contextLost(event) {
    event.preventDefault(); lost = true; cancelAnimationFrame(frame); frame = 0;
    renderer.domElement.hidden = true; fallback.hidden = false; labels.forEach(e => e.hidden = true);
  }
  function contextRestored() { lost = false; renderer.domElement.hidden = false; fallback.hidden = true; resize(); }
  setWires(pose.x, model.separate); resize(); fallback.hidden = true;
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(mount);
  document.addEventListener('visibilitychange', visibility);
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  renderer.domElement.addEventListener('webglcontextrestored', contextRestored);
  return { update, dispose() {
    cancelAnimationFrame(frame); resizeObserver.disconnect(); document.removeEventListener('visibilitychange', visibility);
    const geometries = new Set(), mats = new Set();
    scene.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) mats.add(o.material); });
    geometries.forEach(g => g.dispose()); mats.forEach(m => m.dispose()); renderer.dispose(); renderer.domElement.remove();
  }};
}
