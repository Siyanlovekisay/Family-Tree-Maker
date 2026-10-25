// =========================================
// 1. GET THE ELEMENTS WE NEED
// =========================================
const workspace  = document.getElementById("workspace");
const toggleBtn  = document.getElementById("sidebar-toggle");
const canvas     = document.getElementById("canvas");
const stage      = document.getElementById("stage");
const titleInput = document.getElementById("tree-title");
const toastEl    = document.getElementById("toast");

// add / edit popup
const modal            = document.getElementById("modal");
const modalTitle       = document.getElementById("modal-title");
const modalSubmit      = document.getElementById("modal-submit");
const form             = document.getElementById("person-form");
const nameInput        = document.getElementById("person-name");
const monthInput       = document.getElementById("person-month");
const dayInput         = document.getElementById("person-day");
const yearInput        = document.getElementById("person-year");
const photoInput       = document.getElementById("person-photo");
const photoPreview     = document.getElementById("photo-preview");
const photoPlaceholder = document.getElementById("photo-placeholder");

// tap menu + details card
const menu          = document.getElementById("node-menu");
const menuMain      = document.getElementById("menu-main");
const menuRelations = document.getElementById("menu-relations");
const details       = document.getElementById("details");
const detailsBox    = document.getElementById("details-box");


// =========================================
// 2. THE DATA (everything on screen comes from these)
// =========================================
let people  = [];    // { id, name, month, day, year, photo, parents: [ids], x, y }
let couples = [];    // { a: personId, b: personId }
let history = [];    // old copies of everything, for Undo
let scale = 1;       // zoom level
let themeIndex = 0;  // which theme is active
let selectMode = false;      // is the Select tool on?
const selected = new Set();  // ids of the selected people

const GAP_X = 180;   // space between boxes sideways
const GAP_Y = 170;   // space between generations

// one copy of EVERYTHING, so Undo restores people and couples together
function snapshot() {
  return JSON.stringify({ people: people, couples: couples });
}

function pushHistory(copy) {
  history.push(copy);
  if (history.length > 50) history.shift();   // keep the last 50 only
}

function personById(id) {
  return people.find(function (q) { return q.id === id; });
}


// =========================================
// 3. TOAST (small message at the bottom)
// =========================================
let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toastEl.classList.remove("show");
  }, 1800);
}


// =========================================
// 4. CONNECTION LINES (SVG)
// =========================================
const SVG_NS = "http://www.w3.org/2000/svg";
let linesSvg = null;          // the SVG layer
let nodeEls = new Map();      // person id -> the box on screen

function coupleKey(a, b) {
  return [a, b].sort().join("-");
}

// position and size of a person's box, in stage coordinates
function boxOf(p) {
  const el = nodeEls.get(p.id);
  if (!el) return null;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  return { x: p.x, y: p.y, w: w, h: h,
           cx: p.x + w / 2, cy: p.y + h / 2,
           right: p.x + w, bottom: p.y + h };
}

function svgPath(d, cls) {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("class", cls);
  linesSvg.appendChild(path);
}

function svgDot(x, y) {
  const dot = document.createElementNS(SVG_NS, "circle");
  dot.setAttribute("cx", x);
  dot.setAttribute("cy", y);
  dot.setAttribute("r", 5);
  dot.setAttribute("class", "couple-dot");
  linesSvg.appendChild(dot);
}

function drawLines() {
  if (!linesSvg) return;
  linesSvg.innerHTML = "";               // wipe the old lines
  const coupleMid = {};                  // where each couple's dot is

  // ---- partner lines ----
  couples.forEach(function (c) {
    const pa = personById(c.a);
    const pb = personById(c.b);
    if (!pa || !pb) return;
    const A = boxOf(pa);
    const B = boxOf(pb);
    if (!A || !B) return;

    const left  = A.x <= B.x ? A : B;
    const right = A.x <= B.x ? B : A;

    const x1 = left.right, y1 = left.cy;   // right edge of the left box
    const x2 = right.x,    y2 = right.cy;  // left edge of the right box
    svgPath("M" + x1 + " " + y1 + " L" + x2 + " " + y2, "line partner-line");

    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    svgDot(mx, my);
    coupleMid[coupleKey(c.a, c.b)] = { x: mx, y: my };
  });

  // ---- children: group kids who share the same parents ----
  const groups = {};
  people.forEach(function (child) {
    const parentIds = child.parents.filter(function (id) { return nodeEls.has(id); });
    if (parentIds.length === 0) return;

    const key = parentIds.slice().sort().join("-");
    if (!groups[key]) groups[key] = { parentIds: parentIds, kids: [] };
    groups[key].kids.push(child);
  });

  Object.keys(groups).forEach(function (key) {
    const g = groups[key];
    const parentBoxes = g.parentIds.map(function (id) { return boxOf(personById(id)); });
    const kidBoxes = g.kids.map(function (k) { return boxOf(k); });

    // where the vertical line starts
    let ox, oy;
    const mid = g.parentIds.length === 2
      ? coupleMid[coupleKey(g.parentIds[0], g.parentIds[1])]
      : null;

    if (mid) {                               // a couple: start at the dot
      ox = mid.x;
      oy = mid.y;
    } else {                                 // one parent: start under their box
      ox = parentBoxes.reduce(function (s, b) { return s + b.cx; }, 0) / parentBoxes.length;
      oy = Math.max.apply(null, parentBoxes.map(function (b) { return b.bottom; }));
    }

    // the horizontal bar sits halfway between parents and children
    const parentBottom = Math.max.apply(null, parentBoxes.map(function (b) { return b.bottom; }));
    const kidTop = Math.min.apply(null, kidBoxes.map(function (b) { return b.y; }));
    const busY = (parentBottom + kidTop) / 2;

    // one path: down, across, then down into each child
    let d = "M" + ox + " " + oy + " V" + busY;
    const xs = kidBoxes.map(function (b) { return b.cx; }).concat(ox);
    d += " M" + Math.min.apply(null, xs) + " " + busY + " H" + Math.max.apply(null, xs);
    kidBoxes.forEach(function (b) {
      d += " M" + b.cx + " " + busY + " V" + b.y;
    });

    svgPath(d, "line");
  });
}


// =========================================
// 5. DRAW THE PEOPLE (render)
// =========================================
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// turns the saved parts into text, even if some are missing
function formatBirthday(p) {
  let text = "";
  if (p.month) text = MONTHS[p.month - 1];
  if (p.day)   text += (text ? " " : "") + p.day;
  if (p.year)  text += (text ? (p.day ? ", " : " ") : "") + p.year;
  return text ? "b. " + text : "";
}

function render() {
    // forget selected people who no longer exist (removed or undone)
  selected.forEach(function (id) {
    if (!personById(id)) selected.delete(id);
  });
  stage.innerHTML = "";
  nodeEls = new Map();

  // the line layer goes in FIRST, so the boxes sit on top of it
  linesSvg = document.createElementNS(SVG_NS, "svg");
  linesSvg.setAttribute("class", "tree-lines");
  stage.appendChild(linesSvg);

  people.forEach(function (p) {
    const box = document.createElement("div");
    box.className = "node";
        if (selected.has(p.id)) box.classList.add("selected");
    box.style.left = p.x + "px";
    box.style.top = p.y + "px";

    // picture, or a circle with the first letter
    if (p.photo) {
      const img = document.createElement("img");
      img.className = "node-photo";
      img.src = p.photo;
      img.alt = p.name;
      box.appendChild(img);
    } else {
      const initial = document.createElement("div");
      initial.className = "node-initial";
      initial.textContent = p.name.charAt(0).toUpperCase();
      box.appendChild(initial);
    }

    const nameEl = document.createElement("div");
    nameEl.className = "node-name";
    nameEl.textContent = p.name;
    box.appendChild(nameEl);

    const birthday = formatBirthday(p);
    if (birthday) {
      const dateEl = document.createElement("div");
      dateEl.className = "node-year";
      dateEl.textContent = birthday;
      box.appendChild(dateEl);
    }

    box.addEventListener("pointerdown", function (e) { startDrag(e, p, box); });

    stage.appendChild(box);
    nodeEls.set(p.id, box);
  });

  drawLines();    // boxes exist now, so we can measure them
}


// =========================================
// 6. ADD / EDIT POPUP
// =========================================
let pendingPhoto = "";
let editingId = null;         // null = adding, a number = editing that person
let pendingRelation = null;   // { type, anchorId } when adding a relative

function openModal(person, relation) {
  editingId = person ? person.id : null;
  pendingRelation = relation || null;

  if (relation) {
    const anchor = personById(relation.anchorId);
    const label = relation.type.charAt(0).toUpperCase() + relation.type.slice(1);
    modalTitle.textContent = "Add " + label + " of " + anchor.name;
    modalSubmit.textContent = "Add to Tree";
  } else {
    modalTitle.textContent  = person ? "Edit Person" : "Add Person";
    modalSubmit.textContent = person ? "Save Changes" : "Add to Tree";
  }

  nameInput.value  = person ? person.name  : "";
  monthInput.value = person ? person.month : "";
  dayInput.value   = person ? person.day   : "";
  yearInput.value  = person ? person.year  : "";
  photoInput.value = "";
  pendingPhoto     = person ? (person.photo || "") : "";

  if (pendingPhoto) {
    photoPreview.src = pendingPhoto;
    photoPreview.style.display = "block";
    photoPlaceholder.style.display = "none";
  } else {
    photoPreview.style.display = "none";
    photoPlaceholder.style.display = "block";
  }

  modal.classList.add("open");
  nameInput.focus();
}

function closeModal() {
  modal.classList.remove("open");
  pendingRelation = null;
}

// the wrapper matters: without it the click event would be passed in as "person"
document.getElementById("btn-add").addEventListener("click", function () {
  openModal();
});
document.getElementById("modal-cancel").addEventListener("click", closeModal);

modal.addEventListener("click", function (e) {
  if (e.target === modal) closeModal();
});

// when a photo is chosen: crop to a small square and keep it
photoInput.addEventListener("change", function () {
  const file = photoInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function () {
    const img = new Image();
    img.onload = function () {
      const size = 150;
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;

      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      c.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, size, size);

      pendingPhoto = c.toDataURL("image/jpeg", 0.8);
      photoPreview.src = pendingPhoto;
      photoPreview.style.display = "block";
      photoPlaceholder.style.display = "none";
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

form.addEventListener("submit", function (e) {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (name === "") return;

  pushHistory(snapshot());

  const info = {
    name: name,
    month: monthInput.value,
    day: dayInput.value,
    year: yearInput.value,
    photo: pendingPhoto
  };

  if (editingId !== null) {
    // EDIT an existing person
    const p = personById(editingId);
    p.name  = info.name;
    p.month = info.month;
    p.day   = info.day;
    p.year  = info.year;
    p.photo = info.photo;
  } else if (pendingRelation) {
    // ADD a relative of someone
    addRelative(pendingRelation.type, pendingRelation.anchorId, info);
  } else {
    // ADD a brand new person
    const n = people.length;
    people.push({
      id: Date.now(),
      name: info.name,
      month: info.month,
      day: info.day,
      year: info.year,
      photo: info.photo,
      parents: [],
      x: 40 + (n % 5) * GAP_X,
      y: 40 + Math.floor(n / 5) * GAP_Y
    });
  }

  render();
  closeModal();
});


// =========================================
// 7. RELATIONSHIPS
// =========================================

// is another box already sitting near this spot?
function isTaken(x, y) {
  return people.some(function (q) {
    return Math.abs(q.x - x) < 150 && Math.abs(q.y - y) < 130;
  });
}

// slide to the right until the spot is free
function freeSpot(x, y) {
  while (isTaken(x, y)) x += GAP_X;
  return { x: x, y: y };
}

function sameParents(a, b) {
  return a.length === b.length && a.every(function (id) { return b.includes(id); });
}

// the first partner of a person (or null)
function findPartner(p) {
  const c = couples.find(function (c) { return c.a === p.id || c.b === p.id; });
  if (!c) return null;
  const otherId = (c.a === p.id) ? c.b : c.a;
  return personById(otherId) || null;
}

function addRelative(type, anchorId, info) {
  const anchor = personById(anchorId);
  if (!anchor) return;

  const person = {
    id: Date.now(),
    name: info.name,
    month: info.month,
    day: info.day,
    year: info.year,
    photo: info.photo,
    parents: [],
    x: 0,
    y: 0
  };

  if (type === "partner") {
    person.x = anchor.x + GAP_X;
    person.y = anchor.y;
    couples.push({ a: anchor.id, b: person.id });

    // children who currently have ONLY the anchor as a parent
    const soloKids = people.filter(function (q) {
      return q.parents.length === 1 && q.parents[0] === anchor.id;
    });

    if (soloKids.length > 0) {
      const names = soloKids.map(function (q) { return q.name; }).join(", ");
      if (confirm("Is " + names + " also a child of " + info.name + "?")) {
        soloKids.forEach(function (q) { q.parents.push(person.id); });
      }
    }

  } else if (type === "child") {
    const partner = findPartner(anchor);
    person.parents = partner ? [anchor.id, partner.id] : [anchor.id];
    person.x = partner ? (anchor.x + partner.x) / 2 : anchor.x;   // between the couple
    person.y = Math.max(anchor.y, partner ? partner.y : anchor.y) + GAP_Y;

  } else if (type === "sibling") {
    person.parents = anchor.parents.slice();   // same parents = siblings
    person.x = anchor.x + GAP_X;
    person.y = anchor.y;

  } else if (type === "parent") {
    const existing = anchor.parents.length ? personById(anchor.parents[0]) : null;

    // full siblings get the new parent too, so they stay siblings
    people.forEach(function (q) {
      if (q.id !== anchor.id && q.parents.length > 0 && sameParents(q.parents, anchor.parents)) {
        q.parents.push(person.id);
      }
    });
    anchor.parents.push(person.id);

    if (existing) {
      person.x = existing.x + GAP_X;           // next to the first parent
      person.y = existing.y;
      couples.push({ a: existing.id, b: person.id });
    } else {
      person.x = anchor.x;
      person.y = anchor.y - GAP_Y;
    }
  }

  const spot = freeSpot(person.x, person.y);
  person.x = spot.x;
  person.y = spot.y;
  people.push(person);
}

// everyone related to a person (used by the details card)
function relativesOf(p) {
  return {
    partners: couples
      .filter(function (c) { return c.a === p.id || c.b === p.id; })
      .map(function (c) { return personById(c.a === p.id ? c.b : c.a); })
      .filter(Boolean),
    parents: p.parents.map(personById).filter(Boolean),
    children: people.filter(function (q) { return q.parents.includes(p.id); }),
    siblings: people.filter(function (q) {
      return q.id !== p.id && q.parents.some(function (id) { return p.parents.includes(id); });
    })
  };
}

function removePerson(p) {
  pushHistory(snapshot());
  people = people.filter(function (x) { return x.id !== p.id; });
  couples = couples.filter(function (c) { return c.a !== p.id && c.b !== p.id; });
  people.forEach(function (q) {
    q.parents = q.parents.filter(function (id) { return id !== p.id; });
  });
  render();
  toast(p.name + " removed. Press Undo to bring back");
}


// =========================================
// 8. TAP MENU + DETAILS CARD
// =========================================
let menuTarget = null;     // the person the menu belongs to

function openMenu(p, box) {
  menuTarget = p;
  menuMain.hidden = false;       // always start on the main choices
  menuRelations.hidden = true;
  menu.classList.add("open");

  // place it beside the box, and keep it inside the screen
  const r = box.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;

  let left = r.right + 10;
  if (left + mw > window.innerWidth - 8) left = r.left - mw - 10;   // no room? go left
  left = Math.max(8, left);

  let top = Math.min(r.top, window.innerHeight - mh - 8);
  top = Math.max(8, top);

  menu.style.left = left + "px";
  menu.style.top = top + "px";
}

function closeMenu() {
  menu.classList.remove("open");
  menuTarget = null;
  clearSelection();
  closeThemePanel();
}

// close the menu when the user presses anywhere outside it
document.addEventListener("pointerdown", function (e) {
  if (menu.classList.contains("open") && !menu.contains(e.target)) {
    closeMenu();
  }
});

menu.addEventListener("click", function (e) {
  const btn = e.target.closest("button");
  if (!btn || !menuTarget) return;

  const action = btn.dataset.action;
  const p = menuTarget;

  if (action === "relationship") {          // show the second list
    menuMain.hidden = true;
    menuRelations.hidden = false;
    return;
  }
  if (action === "back") {
    menuMain.hidden = false;
    menuRelations.hidden = true;
    return;
  }

  if (btn.dataset.relation) {               // Partner / Child / Parent / Sibling
    const type = btn.dataset.relation;

    if (type === "parent" && p.parents.length >= 2) {
      closeMenu();
      toast(p.name + " already has two parents");
      return;
    }
    if (type === "sibling" && p.parents.length === 0) {
      closeMenu();
      toast("Add a parent first, so siblings have someone to connect to");
      return;
    }

    closeMenu();
    openModal(null, { type: type, anchorId: p.id });
    return;
  }

  closeMenu();
  if (action === "details") openDetails(p);
  if (action === "edit")    openModal(p);
  if (action === "remove")  removePerson(p);
});

// --- details card ---
const FULL_MONTHS = ["January", "February", "March", "April", "May", "June",
                     "July", "August", "September", "October", "November", "December"];

function fullBirthday(p) {
  const parts = [];
  if (p.month) parts.push(FULL_MONTHS[p.month - 1]);
  if (p.day)   parts.push(p.day);
  let text = parts.join(" ");
  if (p.year) text += (text ? (p.day ? ", " : " ") : "") + p.year;
  return text;
}

// =========================================
// 8.5 PROFILE PANEL: folders (Pictures + Stories)
// =========================================

// ---- tiny helper that builds an element ----
function make(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function newId() {
  return "m" + Date.now() + Math.random().toString(36).slice(2, 7);
}

// ---- IndexedDB: the browser's bigger storage (for pictures and stories) ----
let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise(function (resolve, reject) {
      const req = indexedDB.open("familyTreeMedia", 1);
      req.onupgradeneeded = function () {
        const store = req.result.createObjectStore("media", { keyPath: "id" });
        store.createIndex("personId", "personId");
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  return dbPromise;
}

// save one item (a picture or a story)
async function dbPut(item) {
  try {
    const db = await openDB();
    await new Promise(function (resolve, reject) {
      const tx = db.transaction("media", "readwrite");
      tx.objectStore("media").put(item);
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error); };
    });
    return true;
  } catch (err) {
    console.log(err);
    toast("Could not save to this browser");
    return false;
  }
}

// delete one item
async function dbRemove(id) {
  try {
    const db = await openDB();
    await new Promise(function (resolve, reject) {
      const tx = db.transaction("media", "readwrite");
      tx.objectStore("media").delete(id);
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error); };
    });
  } catch (err) {
    console.log(err);
  }
}

// get everything of one kind that belongs to one person
async function dbList(personId, kind) {
  try {
    const db = await openDB();
    const all = await new Promise(function (resolve, reject) {
      const req = db.transaction("media").objectStore("media")
                    .index("personId").getAll(personId);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return all
      .filter(function (item) { return item.kind === kind; })
      .sort(function (a, b) { return a.created - b.created; });
  } catch (err) {
    console.log(err);
    return [];
  }
}

// shrink a picture so it doesn't fill up the storage
function shrinkImage(file, maxSide) {
  return new Promise(function (resolve) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * ratio);
      c.height = Math.round(img.height * ratio);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(function (blob) { resolve(blob); }, "image/jpeg", 0.85);
    };
    img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// ---- helpers for picture files ----
let liveUrls = [];     // temporary links to picture files, cleaned up later

// a picture file needs a temporary link before an <img> can show it
function urlFor(item) {
  if (item.blob) {
    const u = URL.createObjectURL(item.blob);
    liveUrls.push(u);
    return u;
  }
  return item.data;    // old pictures that were saved as text
}

function revokeUrls() {
  liveUrls.forEach(function (u) { URL.revokeObjectURL(u); });
  liveUrls = [];
}

// turns old text-pictures into real files (saves space)
async function migratePictures(items) {
  for (const item of items) {
    if (!item.blob && item.data) {
      try {
        const res = await fetch(item.data);
        item.blob = await res.blob();
        delete item.data;
        await dbPut(item);
      } catch (err) {
        console.log(err);
      }
    }
  }
}

function formatBytes(n) {
  if (n >= 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(1) + " GB";
  return Math.round(n / (1024 * 1024)) + " MB";
}

// the storage meter text
async function storageLine() {
  if (!navigator.storage || !navigator.storage.estimate) return "";
  const e = await navigator.storage.estimate();
  if (!e.quota) return "";
  const almostFull = e.usage / e.quota > 0.8;
  return (almostFull ? "⚠️ Almost full. " : "") +
         "Browser storage: " + formatBytes(e.usage) +
         " used of about " + formatBytes(e.quota);
}

function openLightbox(src) {
  const box = make("div", "lightbox");
  const img = document.createElement("img");
  img.src = src;
  box.appendChild(img);
  box.addEventListener("click", function () { box.remove(); });
  document.body.appendChild(box);
}

// ---- the panel itself ----
function openDetails(p) {
  details.classList.add("open");
  showProfile(p);
}

function folderTile(icon, name, count, onClick) {
  const tile = make("button", "folder-tile");
  tile.appendChild(make("span", "folder-icon", icon));
  tile.appendChild(make("span", "folder-name", name));
  tile.appendChild(make("span", "folder-count", count + (count === 1 ? " item" : " items")));
  tile.addEventListener("click", onClick);
  return tile;
}

// VIEW 1: the profile with its folders
async function showProfile(p) {
  revokeUrls();
  const pictures = await dbList(p.id, "picture");
  const stories  = await dbList(p.id, "story");

  detailsBox.innerHTML = "";

  const head = make("div", "profile-head");
  if (p.photo) {
    const img = make("img", "details-photo");
    img.src = p.photo;
    img.alt = p.name;
    head.appendChild(img);
  } else {
    head.appendChild(make("div", "details-initial", p.name.charAt(0).toUpperCase()));
  }

  const info = make("div");
  info.appendChild(make("h2", "", p.name));
  info.appendChild(make("p", "details-line",
    fullBirthday(p) ? "Born " + fullBirthday(p) : "Birthday not added"));

  const rel = relativesOf(p);
  [["Partner", rel.partners], ["Parents", rel.parents],
   ["Children", rel.children], ["Siblings", rel.siblings]].forEach(function (row) {
    if (row[1].length === 0) return;
    info.appendChild(make("p", "details-line",
      row[0] + ": " + row[1].map(function (q) { return q.name; }).join(", ")));
  });
  head.appendChild(info);
  detailsBox.appendChild(head);

  detailsBox.appendChild(make("h3", "folders-title", "Folders"));
  const grid = make("div", "folder-grid");
  grid.appendChild(folderTile("🖼️", "Pictures", pictures.length, function () { showPictures(p); }));
  grid.appendChild(folderTile("📖", "Stories", stories.length, function () { showStories(p); }));
  detailsBox.appendChild(grid);

  const closeBtn = make("button", "btn-ok", "Close");
  closeBtn.style.marginTop = "18px";
  closeBtn.addEventListener("click", function () { details.classList.remove("open"); });
  detailsBox.appendChild(closeBtn);
}

// VIEW 2: the Pictures folder
async function showPictures(p) {
  const items = await dbList(p.id, "picture");
  await migratePictures(items);
  revokeUrls();                       // clean up links from the last view
  detailsBox.innerHTML = "";

  const back = make("button", "back-btn", "← Back to " + p.name);
  back.addEventListener("click", function () { showProfile(p); });
  detailsBox.appendChild(back);

  const head = make("div", "folder-head");
  head.appendChild(make("h2", "", "Pictures"));

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.multiple = true;
  fileInput.style.display = "none";

  const addBtn = make("button", "btn-ok", "+ Add pictures");
  addBtn.addEventListener("click", function () { fileInput.click(); });

  fileInput.addEventListener("change", async function () {
    addBtn.textContent = "Saving...";

    // ask the browser to keep our storage instead of cleaning it up
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

    let failed = 0;
    for (const file of fileInput.files) {
      const blob = await shrinkImage(file, 1200);
      if (!blob) { failed++; continue; }
      await dbPut({ id: newId(), personId: p.id, kind: "picture", blob: blob, created: Date.now() });
    }
    if (failed > 0) toast(failed + " picture(s) could not be read");
    showPictures(p);
  });

  head.appendChild(addBtn);
  head.appendChild(fileInput);
  detailsBox.appendChild(head);

  if (items.length === 0) {
    detailsBox.appendChild(make("p", "empty-note", "No pictures yet. Add the first one!"));
  } else {
    const grid = make("div", "pic-grid");
    items.forEach(function (item) {
      const cell = make("div", "pic-item");
      const src = urlFor(item);

      const img = document.createElement("img");
      img.src = src;
      img.alt = "Picture of " + p.name;
      img.addEventListener("click", function () { openLightbox(src); });
      cell.appendChild(img);

      const del = make("button", "pic-del", "✕");
      del.addEventListener("click", async function () {
        if (!confirm("Delete this picture?")) return;
        await dbRemove(item.id);
        showPictures(p);
      });
      cell.appendChild(del);

      grid.appendChild(cell);
    });
    detailsBox.appendChild(grid);
  }

  // storage meter at the bottom
  const line = await storageLine();
  if (line) detailsBox.appendChild(make("p", "storage-line", line));
}

// VIEW 3: the Stories folder
async function showStories(p) {
  const items = await dbList(p.id, "story");
  detailsBox.innerHTML = "";

  const back = make("button", "back-btn", "← Back to " + p.name);
  back.addEventListener("click", function () { showProfile(p); });
  detailsBox.appendChild(back);

  detailsBox.appendChild(make("h2", "", "Stories"));

  const input = document.createElement("textarea");
  input.className = "story-input";
  input.placeholder = "Write a memory of " + p.name + "...";
  detailsBox.appendChild(input);

  const saveBtn = make("button", "btn-ok", "Save story");
  saveBtn.style.marginTop = "10px";
  saveBtn.addEventListener("click", async function () {
    const text = input.value.trim();
    if (text === "") return;
    await dbPut({ id: newId(), personId: p.id, kind: "story", data: text, created: Date.now() });
    showStories(p);
  });
  detailsBox.appendChild(saveBtn);

  if (items.length === 0) {
    detailsBox.appendChild(make("p", "empty-note", "No stories yet."));
    return;
  }

  // newest first
  items.slice().reverse().forEach(function (item) {
    const card = make("div", "story-item");
    card.appendChild(make("div", "story-date", new Date(item.created).toLocaleDateString()));
    card.appendChild(make("div", "story-text", item.data));

    const del = make("button", "story-del", "Delete");
    del.addEventListener("click", async function () {
      if (!confirm("Delete this story?")) return;
      await dbRemove(item.id);
      showStories(p);
    });
    card.appendChild(del);

    detailsBox.appendChild(card);
  });
}

details.addEventListener("click", function (e) {
  if (e.target === details) details.classList.remove("open");
});

// Esc closes whatever is open
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    closeMenu();
    closeModal();
    details.classList.remove("open");
  }
});


// =========================================
// 9. MOVING THINGS: drag boxes, pan canvas, zoom, select
// =========================================
let panX = 0, panY = 0;        // how far the canvas is slid around
const pointers = new Map();    // every finger/mouse currently pressed
let drag = null;               // set while dragging box(es)
let panning = null;            // set while dragging the empty canvas
let pinch = null;              // set while two fingers are down
let marquee = null;            // set while drawing a selection box

// apply pan + zoom to the stage
function applyView() {
  stage.style.transform =
    "translate(" + panX + "px, " + panY + "px) scale(" + scale + ")";
}

// zoom while keeping the point under (cx, cy) in place
function zoomAt(newScale, cx, cy) {
  newScale = Math.min(2.5, Math.max(0.3, newScale));   // limit 30% to 250%
  const worldX = (cx - panX) / scale;
  const worldY = (cy - panY) / scale;
  scale = newScale;
  panX = cx - worldX * scale;
  panY = cy - worldY * scale;
  applyView();
}

function clearSelection() {
  selected.clear();
  nodeEls.forEach(function (el) { el.classList.remove("selected"); });
}

// pressing a box starts a possible drag (or a tap)
function startDrag(e, p, box) {
  let wasSelected = false;
  const members = [];                     // everything that moves together

  if (selectMode) {
    wasSelected = selected.has(p.id);
    if (!wasSelected) {                   // first touch adds them to the selection
      selected.add(p.id);
      box.classList.add("selected");
    }
    selected.forEach(function (id) {
      const q = personById(id);
      const el = nodeEls.get(id);
      if (q && el) members.push({ p: q, box: el, origX: q.x, origY: q.y });
    });
  } else {
    members.push({ p: p, box: box, origX: p.x, origY: p.y });
  }

  drag = {
    p: p,
    box: box,
    members: members,
    wasSelected: wasSelected,
    startX: e.clientX,
    startY: e.clientY,
    before: snapshot(),
    moved: false
  };
}

// a finger or mouse goes down on the canvas
canvas.addEventListener("pointerdown", function (e) {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2) {
    // second finger: cancel everything else and start pinching
    drag = null;
    panning = null;
    if (marquee) { marquee.el.remove(); marquee = null; }
    const pts = Array.from(pointers.values());
    pinch = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) };
    return;
  }

  // pressed on empty canvas (not on a box)
  if (!e.target.closest(".node")) {
    if (selectMode) {
      // start drawing a selection box
      clearSelection();
      marquee = { x0: e.clientX, y0: e.clientY, el: document.createElement("div") };
      marquee.el.className = "marquee";
      canvas.appendChild(marquee.el);
    } else {
      // start panning
      panning = { startX: e.clientX, startY: e.clientY, origX: panX, origY: panY };
      canvas.classList.add("panning");
    }
  }
});

// moving
window.addEventListener("pointermove", function (e) {
  if (pointers.has(e.pointerId)) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  // two fingers: pinch zoom
  if (pinch && pointers.size === 2) {
    const pts = Array.from(pointers.values());
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const rect = canvas.getBoundingClientRect();
    const cx = (pts[0].x + pts[1].x) / 2 - rect.left;
    const cy = (pts[0].y + pts[1].y) / 2 - rect.top;
    zoomAt(scale * (dist / pinch.dist), cx, cy);
    pinch.dist = dist;
    return;
  }

  // drawing the selection box
  if (marquee) {
    const rect = canvas.getBoundingClientRect();
    const x1 = Math.min(marquee.x0, e.clientX);
    const x2 = Math.max(marquee.x0, e.clientX);
    const y1 = Math.min(marquee.y0, e.clientY);
    const y2 = Math.max(marquee.y0, e.clientY);

    marquee.el.style.left   = (x1 - rect.left) + "px";
    marquee.el.style.top    = (y1 - rect.top) + "px";
    marquee.el.style.width  = (x2 - x1) + "px";
    marquee.el.style.height = (y2 - y1) + "px";

    // anyone touching the box is selected
    nodeEls.forEach(function (el, id) {
      const r = el.getBoundingClientRect();
      const hit = r.right > x1 && r.left < x2 && r.bottom > y1 && r.top < y2;
      el.classList.toggle("selected", hit);
      if (hit) selected.add(id); else selected.delete(id);
    });
    return;
  }

  // dragging box(es): everyone in the group moves by the same amount
  if (drag) {
    const dx = (e.clientX - drag.startX) / scale;
    const dy = (e.clientY - drag.startY) / scale;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;

    drag.members.forEach(function (m) {
      m.p.x = m.origX + dx;
      m.p.y = m.origY + dy;
      m.box.style.left = m.p.x + "px";
      m.box.style.top = m.p.y + "px";
    });
    drawLines();      // lines follow the boxes
    return;
  }

  // dragging the empty canvas: pan
  if (panning) {
    panX = panning.origX + (e.clientX - panning.startX);
    panY = panning.origY + (e.clientY - panning.startY);
    applyView();
  }
});

// finger or mouse lifted
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;

  if (marquee) {
    marquee.el.remove();
    marquee = null;
    if (selected.size > 0) toast(selected.size + " selected. Drag one to move them all");
  }

  if (drag) {
    if (drag.moved) {
      pushHistory(drag.before);                 // it was a real move
    } else if (e.type === "pointerup") {
      if (selectMode) {
        // a tap in select mode: tapping an already selected person removes them
        if (drag.wasSelected) {
          selected.delete(drag.p.id);
          drag.box.classList.remove("selected");
        }
      } else {
        openMenu(drag.p, drag.box);             // normal tap: show the menu
      }
    }
  }

  drag = null;
  panning = null;
  canvas.classList.remove("panning");
}
window.addEventListener("pointerup", endPointer);
window.addEventListener("pointercancel", endPointer);

// mouse wheel: zoom toward the cursor
canvas.addEventListener("wheel", function (e) {
  e.preventDefault();
  closeMenu();
  const rect = canvas.getBoundingClientRect();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  zoomAt(scale * factor, e.clientX - rect.left, e.clientY - rect.top);
}, { passive: false });


// =========================================
// 9.5 SELECT TOOL (the button)
// =========================================
const selectBtn = document.getElementById("btn-select");

function setSelectMode(on) {
  selectMode = on;
  selectBtn.classList.toggle("active", on);
  canvas.classList.toggle("select-mode", on);
  closeMenu();
  if (!on) clearSelection();
  toast(on ? "Select on: tap people or drag a box around them" : "Select off");
}

selectBtn.addEventListener("click", function () {
  setSelectMode(!selectMode);
});


// =========================================
// 10. UNDO
// =========================================
document.getElementById("btn-undo").addEventListener("click", function () {
  if (history.length === 0) {
    toast("Nothing to undo");
    return;
  }
  const state = JSON.parse(history.pop());
  people = state.people;
  couples = state.couples;
  render();
});


// =========================================
// 11. THEMES
// =========================================
const THEMES = [
  { name: "Parchment", bg: "#F7F0E6", dot: "#d8c9a8", node: "#ffffff", border: "#C9A84C", text: "#3b2f1e" },
  { name: "Dark",      bg: "#1a1a2e", dot: "#33334d", node: "#27274a", border: "#e0b84a", text: "#f1e9ff" },
  { name: "Forest",    bg: "#e8f0e4", dot: "#c3d6bb", node: "#ffffff", border: "#5f9e4a", text: "#1a2e1a" },
  { name: "Ocean",     bg: "#e4eef8", dot: "#bcd2e8", node: "#ffffff", border: "#2a8ac0", text: "#0a2a4a" },
  { name: "Rose",      bg: "#fdf0f4", dot: "#f0cfda", node: "#ffffff", border: "#c05a8a", text: "#2e1a22" }
];

function applyTheme() {
  const t = THEMES[themeIndex];
  canvas.style.setProperty("--canvas-bg", t.bg);
  canvas.style.setProperty("--dot", t.dot);
  canvas.style.setProperty("--node-bg", t.node);
  canvas.style.setProperty("--node-border", t.border);
  canvas.style.setProperty("--node-text", t.text);
}

// ---- the theme picker panel ----
const themeBtn   = document.getElementById("btn-theme");
const themePanel = document.getElementById("theme-panel");

// build one card per theme, from the THEMES list
function buildThemePanel() {
  themePanel.innerHTML = "";
  themePanel.appendChild(make("div", "theme-title", "Choose a theme"));

  THEMES.forEach(function (t, i) {
    const option = make("button", "theme-option");
    if (i === themeIndex) option.classList.add("active");

    const swatch = make("span", "theme-swatch");
    swatch.style.background = t.bg;
    const chip = make("span", "theme-chip");
    chip.style.background = t.node;
    chip.style.borderColor = t.border;
    swatch.appendChild(chip);

    option.appendChild(swatch);
    option.appendChild(make("span", "theme-name", t.name));

    option.addEventListener("click", function () {
      themeIndex = i;
      applyTheme();
      buildThemePanel();      // redraw so the highlight moves
    });

    themePanel.appendChild(option);
  });
}

function openThemePanel() {
  buildThemePanel();
  themePanel.classList.add("open");

  // place it next to the Theme button, and keep it on screen
  const r  = themeBtn.getBoundingClientRect();
  const pw = themePanel.offsetWidth;
  const ph = themePanel.offsetHeight;
  let left, top;

  if (window.matchMedia("(max-width: 600px)").matches) {
    left = (window.innerWidth - pw) / 2;      // phone: toolbar is at the bottom
    top  = r.top - ph - 10;                   // so open above it
  } else {
    left = r.right + 10;                      // computer: open to the right
    top  = Math.min(r.top, window.innerHeight - ph - 8);
  }

  themePanel.style.left = Math.max(8, left) + "px";
  themePanel.style.top  = Math.max(8, top) + "px";
}

function closeThemePanel() {
  themePanel.classList.remove("open");
      closeSavePanel();
}

themeBtn.addEventListener("click", function () {
  if (themePanel.classList.contains("open")) closeThemePanel();
  else openThemePanel();
});

// pressing anywhere outside the panel closes it
document.addEventListener("pointerdown", function (e) {
  if (themePanel.classList.contains("open") &&
      !themePanel.contains(e.target) &&
      !themeBtn.contains(e.target)) {
    closeThemePanel();
  }
});


// =========================================
// 12. SAVE + LOAD (kept in this browser)
// =========================================
function save() {
  try {
    localStorage.setItem("familyTree", JSON.stringify({
      title: titleInput.value,
      people: people,
      couples: couples,
      theme: themeIndex
    }));
    toast("Saved ✔");
  } catch (err) {
    toast("Could not save");
  }
}

function load() {
  try {
    const raw = localStorage.getItem("familyTree");
    if (!raw) return;
    const data = JSON.parse(raw);
    titleInput.value = data.title || "";
    people = data.people || [];
    couples = data.couples || [];
    themeIndex = data.theme || 0;

    // people saved before relationships existed have no parents list yet
    people.forEach(function (p) {
      if (!p.parents) p.parents = [];
    });
  } catch (err) {
    console.log("Could not load saved tree", err);
  }
}

// =========================================
// 12.5 SAVE PANEL: browser / image / ZIP
// =========================================
const saveToolBtn = document.getElementById("btn-save");
const savePanel   = document.getElementById("save-panel");

function treeTitle() {
  return titleInput.value.trim() || "My Family Tree";
}

// a safe file name made from the family name
function fileSlug() {
  const s = treeTitle().replace(/[\\/:*?"<>|]+/g, "").trim().replace(/\s+/g, "-");
  return s || "family-tree";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
}

// ---------- IMAGE (PNG) ----------
function loadImg(src) {
  return new Promise(function (resolve) {
    const img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { resolve(null); };
    img.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function exportPNG() {
  if (people.length === 0) { toast("Add someone first"); return; }
  toast("Making your picture...");
  drawLines();                            // make sure the lines are up to date

  const t = THEMES[themeIndex];
  const PAD = 60, TITLE_H = 120, MIN_W = 720;

  // find the edges of the tree
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const boxes = new Map();
  people.forEach(function (p) {
    const b = boxOf(p);
    if (!b) return;
    boxes.set(p.id, b);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.right);
    maxY = Math.max(maxY, b.bottom);
  });

  const treeW = maxX - minX;
  const W = Math.max(treeW + PAD * 2, MIN_W);
  const H = (maxY - minY) + PAD * 2 + TITLE_H;
  const offX = (W - treeW) / 2 - minX;      // centers the tree
  const offY = PAD + TITLE_H - minY;        // leaves room for the title

  const S = Math.min(2, 8000 / W, 8000 / H);   // sharper, but never too huge
  const c = document.createElement("canvas");
  c.width = Math.round(W * S);
  c.height = Math.round(H * S);
  const ctx = c.getContext("2d");
  ctx.scale(S, S);

  // background
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, W, H);

  // the family name
  ctx.fillStyle = t.text;
  ctx.textAlign = "center";
  ctx.font = "600 44px Georgia, serif";
  ctx.fillText(treeTitle(), W / 2, PAD + 40, W - 40);
  ctx.fillStyle = t.border;
  ctx.fillRect(W / 2 - 40, PAD + 62, 80, 3);

  // from here on we draw in tree coordinates
  ctx.save();
  ctx.translate(offX, offY);

  // lines: reuse the exact paths from the SVG layer
  ctx.strokeStyle = t.border;
  ctx.fillStyle = t.border;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  Array.from(linesSvg.children).forEach(function (el) {
    if (el.tagName === "path") {
      const dashed = el.getAttribute("class").includes("partner-line");
      ctx.setLineDash(dashed ? [6, 6] : []);
      ctx.stroke(new Path2D(el.getAttribute("d")));
    } else if (el.tagName === "circle") {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(+el.getAttribute("cx"), +el.getAttribute("cy"), +el.getAttribute("r"), 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.setLineDash([]);

  // the people
  for (const p of people) {
    const b = boxes.get(p.id);
    if (!b) continue;

    // box
    roundRect(ctx, b.x, b.y, b.w, b.h, 12);
    ctx.fillStyle = t.node;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = t.border;
    ctx.stroke();

    // photo, or a circle with the first letter
    const cx = b.cx, cy = b.y + 12 + 32;
    if (p.photo) {
      const img = await loadImg(p.photo);
      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, 32, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, cx - 32, cy - 32, 64, 64);
        ctx.restore();
      }
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, 32, 0, Math.PI * 2);
      ctx.fillStyle = t.border;
      ctx.fill();
      ctx.fillStyle = t.node;
      ctx.font = "600 26px sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(p.name.charAt(0).toUpperCase(), cx, cy + 1);
      ctx.textBaseline = "alphabetic";
    }
    ctx.beginPath();
    ctx.arc(cx, cy, 32, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = t.border;
    ctx.stroke();

    // name and birthday
    ctx.fillStyle = t.text;
    ctx.font = "600 14px sans-serif";
    ctx.fillText(p.name, cx, b.y + 98, b.w - 16);
    const bd = formatBirthday(p);
    if (bd) {
      ctx.globalAlpha = 0.7;
      ctx.font = "12px sans-serif";
      ctx.fillText(bd, cx, b.y + 114, b.w - 16);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();

  c.toBlob(function (blob) {
    if (!blob) { toast("Could not make the picture"); return; }
    downloadBlob(blob, fileSlug() + ".png");
    toast("Picture saved");
  }, "image/png");
}

// ---------- ZIP ----------
async function dbAll() {
  try {
    const db = await openDB();
    return await new Promise(function (resolve, reject) {
      const req = db.transaction("media").objectStore("media").getAll();
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  } catch (err) {
    console.log(err);
    return [];
  }
}

async function exportZIP(setLabel) {
  if (typeof JSZip === "undefined") {
    toast("The ZIP tool did not load. Check your internet");
    return;
  }
  if (people.length === 0) { toast("Add someone first"); return; }

  const zip = new JSZip();
  const ids = new Set(people.map(function (p) { return p.id; }));
  const media = (await dbAll()).filter(function (m) { return ids.has(m.personId); });

  const pictures = [];
  const stories = [];

  for (const m of media) {
    if (m.kind === "picture") {
      let blob = m.blob;
      if (!blob && m.data) blob = await (await fetch(m.data)).blob();   // old text-style pictures
      if (!blob) continue;
      const file = "media/" + m.personId + "/" + m.id + ".jpg";
      zip.file(file, blob);
      pictures.push({ id: m.id, personId: m.personId, file: file, created: m.created });
    } else if (m.kind === "story") {
      stories.push({ id: m.id, personId: m.personId, text: m.data, created: m.created });
    }
  }

  zip.file("tree.json", JSON.stringify({
    app: "family-tree",
    version: 1,
    savedAt: new Date().toISOString(),
    title: titleInput.value,
    theme: themeIndex,
    people: people,
    couples: couples,
    pictures: pictures,
    stories: stories
  }, null, 2));

  zip.file("README.txt",
    treeTitle() + "\n\n" +
    "This is a family tree saved from the Family Tree website.\n\n" +
    "tree.json  - names, birthdays, relationships and written stories\n" +
    "media/     - the pictures, in one folder per person\n\n" +
    "To open it again, use Save > Open a saved ZIP on the website.\n" +
    "Keep this file somewhere safe, and add to it for the next generation.\n");

  // STORE = no extra compression, because JPEG files are already compressed
  const blob = await zip.generateAsync(
    { type: "blob", compression: "STORE" },
    function (meta) { setLabel("Packing " + Math.round(meta.percent) + "%"); }
  );

  downloadBlob(blob, fileSlug() + "-family-tree.zip");
  toast("ZIP saved");
}

// ---------- THE PANEL ----------
function saveOption(icon, title, sub, onClick) {
  const b = make("button", "theme-option");
  b.appendChild(make("span", "save-icon", icon));
  const text = make("span", "save-text");
  text.appendChild(make("span", "save-title", title));
  text.appendChild(make("span", "save-sub", sub));
  b.appendChild(text);
  b.addEventListener("click", onClick);
  return b;
}

function placePanel(panel, btn) {
  const r  = btn.getBoundingClientRect();
  const pw = panel.offsetWidth;
  const ph = panel.offsetHeight;
  let left, top;

  if (window.matchMedia("(max-width: 600px)").matches) {
    left = (window.innerWidth - pw) / 2;     // phone: open above the toolbar
    top  = r.top - ph - 10;
  } else {
    left = r.right + 10;                     // computer: open to the right
    top  = Math.min(r.top, window.innerHeight - ph - 8);
  }
  panel.style.left = Math.max(8, left) + "px";
  panel.style.top  = Math.max(8, top) + "px";
}

function buildSavePanel() {
  savePanel.innerHTML = "";
  savePanel.appendChild(make("div", "theme-title", "Save your tree"));

  savePanel.appendChild(saveOption("💾", "Save in this browser",
    "Quick save. It comes back when you reopen the page", function () {
      save();
      closeSavePanel();
    }));

  savePanel.appendChild(saveOption("🖼️", "Download as image",
    "A PNG with the family name on it", function () {
      closeSavePanel();
      exportPNG();
    }));

  const zipBtn = saveOption("📦", "Download as ZIP",
    "Everything: people, pictures and stories", async function () {
      const label = zipBtn.querySelector(".save-title");
      zipBtn.disabled = true;
      label.textContent = "Packing...";
      try {
        await exportZIP(function (text) { label.textContent = text; });
      } catch (err) {
        console.log(err);
        toast("Could not make the ZIP");
      }
      label.textContent = "Download as ZIP";
      zipBtn.disabled = false;
      closeSavePanel();
    });
  savePanel.appendChild(zipBtn);
    // open a saved ZIP
    const openInput = document.createElement("input");
    openInput.type = "file";
    openInput.accept = ".zip,application/zip";
    openInput.style.display = "none";
    openInput.addEventListener("change", async function () {
      const file = openInput.files[0];
      if (!file) return;
      closeSavePanel();
      await importZIP(file);
    });

    savePanel.appendChild(saveOption("📂", "Open a saved ZIP",
      "Load a tree you downloaded before", function () {
        openInput.click();
      }));
    savePanel.appendChild(openInput);
}

function openSavePanel() {
  buildSavePanel();
  savePanel.classList.add("open");
  placePanel(savePanel, saveToolBtn);

  // the storage meter appears a moment later
  storageLine().then(function (line) {
    if (line && savePanel.classList.contains("open")) {
      savePanel.appendChild(make("div", "save-meter", line));
      placePanel(savePanel, saveToolBtn);
    }
  });
}

function closeSavePanel() {
  savePanel.classList.remove("open");
}

saveToolBtn.addEventListener("click", function () {
  if (savePanel.classList.contains("open")) closeSavePanel();
  else openSavePanel();
});

// pressing anywhere outside the panel closes it
document.addEventListener("pointerdown", function (e) {
  if (savePanel.classList.contains("open") &&
      !savePanel.contains(e.target) &&
      !saveToolBtn.contains(e.target)) {
    closeSavePanel();
  }
});

// ---------- OPEN A SAVED ZIP ----------
async function dbClear() {
  try {
    const db = await openDB();
    await new Promise(function (resolve, reject) {
      const tx = db.transaction("media", "readwrite");
      tx.objectStore("media").clear();
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error); };
    });
  } catch (err) {
    console.log(err);
  }
}

async function importZIP(file) {
  if (typeof JSZip === "undefined") {
    toast("The ZIP tool did not load. Check your internet");
    return;
  }

  // 1. open the zip and find tree.json
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (err) {
    toast("That is not a ZIP file");
    return;
  }

  const jsonFile = zip.file("tree.json");
  if (!jsonFile) {
    toast("No tree.json inside. Is this a family tree ZIP?");
    return;
  }

  let data;
  try {
    data = JSON.parse(await jsonFile.async("string"));
  } catch (err) {
    toast("tree.json is damaged");
    return;
  }

  // 2. make sure it looks right before touching anything
  const looksRight =
    data.app === "family-tree" &&
    Array.isArray(data.people) &&
    Array.isArray(data.couples) &&
    data.people.every(function (p) {
      return p && p.id !== undefined && typeof p.name === "string" &&
             typeof p.x === "number" && typeof p.y === "number";
    });

  if (!looksRight) {
    toast("This file is not a Family Tree ZIP");
    return;
  }

  // 3. opening REPLACES what is on screen, so ask first
  if (people.length > 0) {
    if (!confirm("Open this tree? It will replace the tree on screen (" +
                 people.length + " people). Download a ZIP first if you want to keep it.")) {
      return;
    }
  }

  toast("Opening...");

  // 4. bring the pictures and stories back into the browser's storage
  await dbClear();

  for (const pic of data.pictures || []) {
    const entry = zip.file(pic.file);
    if (!entry) continue;                           // skip a missing file
    const buffer = await entry.async("arraybuffer");
    await dbPut({
      id: String(pic.id),
      personId: pic.personId,
      kind: "picture",
      blob: new Blob([buffer], { type: "image/jpeg" }),
      created: pic.created || Date.now()
    });
  }

  for (const s of data.stories || []) {
    await dbPut({
      id: String(s.id),
      personId: s.personId,
      kind: "story",
      data: String(s.text),
      created: s.created || Date.now()
    });
  }

  // 5. bring the tree itself back
  people = data.people;
  people.forEach(function (p) {
    if (!Array.isArray(p.parents)) p.parents = [];
  });
  couples = data.couples;
  titleInput.value = data.title || "";
  themeIndex = (Number.isInteger(data.theme) && THEMES[data.theme]) ? data.theme : 0;

  history = [];
  selected.clear();
  panX = 0;
  panY = 0;
  scale = 1;

  applyTheme();
  applyView();
  render();
  save();                      // also keep it in this browser

  toast("Opened " + (data.title || "tree") + " (" + people.length + " people)");
}


// =========================================
// 13. HIDE / SHOW THE SIDEBAR
// =========================================
toggleBtn.addEventListener("click", function () {
  const collapsed = workspace.classList.toggle("collapsed");
  toggleBtn.textContent = collapsed ? "›" : "‹";
  toggleBtn.setAttribute("aria-label", collapsed ? "Show tools" : "Hide tools");
});

// =========================================
// 13.5 TEMPLATES (opened from the cards on the landing page)
// =========================================
// x and y are in the same units as everything else (boxes are about 140 wide)
// "parents" lists the keys of the parents, "couples" pairs keys that are partners
const TEMPLATES = {
  basic: {
    title: "Basic Family",
    people: [
      { key: "father",  name: "Father",  x: 0,   y: 0 },
      { key: "mother",  name: "Mother",  x: 180, y: 0 },
      { key: "you",     name: "You",     x: 0,   y: 170, parents: ["father", "mother"] },
      { key: "sibling", name: "Sibling", x: 180, y: 170, parents: ["father", "mother"] }
    ],
    couples: [["father", "mother"]]
  },

  grandparents: {
    title: "With Grandparents",
    people: [
      { key: "gf1",     name: "Grandfather", x: 0,   y: 0 },
      { key: "gm1",     name: "Grandmother", x: 180, y: 0 },
      { key: "gf2",     name: "Grandfather", x: 360, y: 0 },
      { key: "gm2",     name: "Grandmother", x: 540, y: 0 },
      { key: "father",  name: "Father",  x: 90,  y: 170, parents: ["gf1", "gm1"] },
      { key: "mother",  name: "Mother",  x: 450, y: 170, parents: ["gf2", "gm2"] },
      { key: "you",     name: "You",     x: 180, y: 340, parents: ["father", "mother"] },
      { key: "sibling", name: "Sibling", x: 360, y: 340, parents: ["father", "mother"] }
    ],
    couples: [["gf1", "gm1"], ["gf2", "gm2"], ["father", "mother"]]
  },

  extended: {
    title: "Extended Family",
    people: [
      { key: "gf",      name: "Grandfather", x: 225, y: 0 },
      { key: "gm",      name: "Grandmother", x: 405, y: 0 },
      { key: "aunt",    name: "Aunt",    x: 0,   y: 170, parents: ["gf", "gm"] },
      { key: "father",  name: "Father",  x: 180, y: 170, parents: ["gf", "gm"] },
      { key: "mother",  name: "Mother",  x: 360, y: 170 },
      { key: "uncle",   name: "Uncle",   x: 630, y: 170, parents: ["gf", "gm"] },
      { key: "wife",    name: "Uncle's Wife", x: 810, y: 170 },
      { key: "you",     name: "You",     x: 180, y: 340, parents: ["father", "mother"] },
      { key: "sibling", name: "Sibling", x: 360, y: 340, parents: ["father", "mother"] },
      { key: "cousin",  name: "Cousin",  x: 720, y: 340, parents: ["uncle", "wife"] }
    ],
    couples: [["gf", "gm"], ["father", "mother"], ["uncle", "wife"]]
  }
};

// zoom and slide so the whole tree fits on screen
function fitView() {
  if (people.length === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  people.forEach(function (p) {
    const b = boxOf(p);
    if (!b) return;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.right);
    maxY = Math.max(maxY, b.bottom);
  });

  const rect = canvas.getBoundingClientRect();
  const PAD = 40;
  const w = maxX - minX;
  const h = maxY - minY;

  scale = Math.min(1, (rect.width - PAD * 2) / w, (rect.height - PAD * 2) / h);
  scale = Math.max(0.3, scale);                          // same limit as zooming
  panX = (rect.width  - w * scale) / 2 - minX * scale;   // center it
  panY = (rect.height - h * scale) / 2 - minY * scale;
  applyView();
}

// turn a template into real people on screen
function buildFromTemplate(t) {
  pushHistory(snapshot());                // so Undo brings the old tree back

  const base = Date.now();
  const idOf = {};
  t.people.forEach(function (p, i) { idOf[p.key] = base + i; });

  people = t.people.map(function (p) {
    return {
      id: idOf[p.key],
      name: p.name,
      month: "",
      day: "",
      year: "",
      photo: "",
      parents: (p.parents || []).map(function (k) { return idOf[k]; }),
      x: p.x,
      y: p.y
    };
  });

  couples = t.couples.map(function (c) {
    return { a: idOf[c[0]], b: idOf[c[1]] };
  });

  selected.clear();
  render();
  fitView();
  toast(t.title + " template. Tap a person, then Edit, to rename them");
}

// looks at the link: tree.html?template=basic
function applyTemplateFromUrl() {
  const name = new URLSearchParams(location.search).get("template");
  if (!name) return;

  // remove it from the link so refreshing doesn't load it a second time
  window.history.replaceState(null, "", location.pathname);

  const t = TEMPLATES[name];
  if (!t) return;

  if (people.length > 0 &&
      !confirm("Start from the \"" + t.title + "\" template? It will replace the tree on screen.")) {
    return;
  }
  buildFromTemplate(t);
}


// =========================================
// 14. START UP
// =========================================
load();
applyTheme();
applyView();
render();
applyTemplateFromUrl();