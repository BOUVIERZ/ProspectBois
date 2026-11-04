// ================================================================
// PROSPECTBOIS v5 - application cartographique de prospection
// ================================================================
"use strict";
const CFG = window.PB_CONFIG;
const APICARTO = "https://apicarto.ign.fr/api";
const GEOPF = "https://data.geopf.fr";

// ---- Contenu de la saisie -------------------------------------
const THEMES = [
  { titre: "Nature et données du peuplement", champs: [
    { k: "nature", l: "Nature", o: ["Résineux", "Feuillus", "Mixte"] },
    { k: "essence", l: "Essences", o: ["Épicéa", "Sapin", "Hêtre", "Érable", "Douglas", "Mélèze", "Chêne", "Frêne"], multi: 1, autre: 1 },
    { k: "traitement", l: "Traitement", o: ["Futaie régulière", "Futaie irrégulière", "Futaie jardinée", "Taillis sous futaie", "Taillis simple"], autre: 1 },
    { k: "diametre", l: "Classes de diamètre", o: ["PB", "BM", "GB"], multi: 1, autre: 1 },
    { k: "sanitaire", l: "État sanitaire", o: ["Bon", "Moyen", "Mauvais"], autre: 1 },
    { k: "qualite", l: "Qualité", o: ["Menuiserie", "Déroulage", "Ébénisterie", "Charpente +", "Charpente", "Standard", "Caisserie", "Palette"], multi: 1, autre: 1 },
    { k: "couvert", l: "Couvert", o: ["Ouvert", "Fermé", "Clairiéré"], autre: 1 }
  ], photos: 1 },
  { titre: "Topographie et infrastructures", champs: [
    { k: "pente", l: "Pente", o: ["Très forte", "Forte", "Modérée", "Faible", "Aucune"], autre: 1 },
    { k: "topo", l: "Éléments présents", o: ["Bloc de roche", "Rupture de pente", "Ruisseau", "Bâtiments", "Réseaux", "Clôture", "Route", "Captage"], multi: 1, autre: 1 }
  ] },
  { titre: "Exploitation", champs: [
    { k: "exploitation", l: "Type d'exploitation", o: ["Manuel", "Mécanisé", "Mixte"], autre: 1 },
    { k: "saison", l: "Saison d'exploitabilité", o: ["Printemps", "Été", "Automne", "Hiver", "Toute l'année"], multi: 1 },
    { k: "desserte", l: "Desserte", o: ["Route forestière", "Piste forestière", "Aucune"], multi: 1, autre: 1 }
  ] }
];
const REGLES = [
  { k: "tonnage", l: "Limitation de tonnage", q: "Combien ?" },
  { k: "periode", l: "Période d'exploitation", q: "Quand ?" },
  { k: "degel", l: "Barrière de dégel", q: "Quand ?" }
];
const STATUTS = { PROSPECTE: ["Prospecté", "#2980b9"], NEGOCIE: ["Négocié", "#f39c12"], SIGNE: ["Signé", "#27ae60"], EXPLOITATION: ["En exploitation", "#e67e22"], TERMINE: ["Terminé", "#7f8c8d"] };

// ---- Utilitaires ----------------------------------------------
const $ = id => document.getElementById(id);
const esc = v => String(v === undefined || v === null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "u" + Date.now().toString(36) + Math.random().toString(36).slice(2));
let toastT;
function toast(m, e) { const t = $("toast"); t.textContent = m; t.className = "toast on" + (e ? " e" : ""); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 3200); }
function ls(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
function lss(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function codeDossier() { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const r = crypto.getRandomValues(new Uint8Array(6)); return Array.from(r, x => a[x % a.length]).join(""); }
function slug(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase(); }
function ha(m2) { return m2 ? (m2 / 10000).toLocaleString("fr-FR", { maximumFractionDigits: 4 }) + " ha" : "—"; }

// ---- Stockage local (IndexedDB) -------------------------------
let dbp;
function db() {
  return dbp = dbp || new Promise((ok, ko) => {
    const r = indexedDB.open("prospectbois", 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      ["dossiers", "annots", "photos", "courriers"].forEach(s => d.createObjectStore(s, { keyPath: "id" }));
      d.createObjectStore("queue", { keyPath: "n", autoIncrement: true });
    };
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((ok, ko) => {
    const t = d.transaction(store, mode), s = t.objectStore(store), r = fn(s);
    t.oncomplete = () => ok(r && r.result); t.onerror = () => ko(t.error); t.onabort = () => ko(t.error);
  });
}
const dbAll = s => tx(s, "readonly", x => x.getAll());
const dbGet = (s, k) => tx(s, "readonly", x => x.get(k));
const dbPut = (s, v) => tx(s, "readwrite", x => x.put(v));
const dbDel = (s, k) => tx(s, "readwrite", x => x.delete(k));

// ---- Etat -----------------------------------------------------
let user = null, apiUrl = CFG.apiUrl || ls("pb5_api", "");
let dossiers = [], annots = [], outil = null, dossierCourant = null, enAjout = false;
let map, gpsPos = null, gpsWatch = null, gpsSuit = false;

// ---- API ------------------------------------------------------
async function apiPost(b) {
  try {
    const r = await fetch(apiUrl, { method: "POST", body: JSON.stringify(Object.assign({ token: user ? user.token : "" }, b)), headers: { "Content-Type": "text/plain" }, redirect: "follow" });
    return JSON.parse(await r.text());
  } catch (e) { return null; }
}
async function apiGet(q) {
  try {
    const r = await fetch(apiUrl + "?" + new URLSearchParams(Object.assign({ token: user ? user.token : "" }, q)), { redirect: "follow" });
    return JSON.parse(await r.text());
  } catch (e) { return null; }
}
function pastille(c) { $("pastille").className = "pastille " + c; }

// ---- File d'envoi : rien n'en sort sans confirmation du serveur
let envoiEnCours = false;
async function enfiler(op) { await dbPut("queue", op); return vider(); }
async function nbAttente() { return (await dbAll("queue")).length; }
function b64(blob) { return new Promise((ok, ko) => { const f = new FileReader(); f.onload = () => ok(String(f.result).split(",")[1]); f.onerror = ko; f.readAsDataURL(blob); }); }
async function preparer(op) {
  if (op.action !== "save_file") return op;
  const src = await dbGet(op.source, op.ref);
  if (!src) return null;
  return { action: "save_file", dossierId: op.dossierId, dossierNom: op.dossierNom, nom: src.nom, mime: src.blob.type, base64: await b64(src.blob) };
}
async function vider() {
  if (envoiEnCours) return false;
  if (!apiUrl || !user) return false;
  envoiEnCours = true;
  try {
    for (;;) {
      const ops = await dbAll("queue");
      if (!ops.length) { pastille("ok"); return true; }
      pastille("");
      const op = ops[0], corps = await preparer(op);
      if (corps) {
        const res = await apiPost(corps);
        if (!res) { pastille("err"); return false; }
        if (res.error === "non_autorise") { pastille("err"); toast("Session expirée : reconnectez-vous", 1); return false; }
        if (res.error) toast("Refusé par le serveur : " + res.error, 1);
        if (op.action === "save_dossier" && res.driveUrl) {
          const d = dossiers.find(x => x.id === op.data.id);
          if (d) { d.driveUrl = res.driveUrl; await dbPut("dossiers", d); }
        }
      }
      await dbDel("queue", op.n);
    }
  } finally { envoiEnCours = false; }
}
let synchroEnCours = null;
function synchroniser() {
  if (!synchroEnCours) synchroEnCours = faireSynchro().finally(() => { synchroEnCours = null; });
  return synchroEnCours;
}
async function faireSynchro() {
  if (!user || !apiUrl) return;
  await resoudreEnAttente();
  await vider();
  const res = await apiGet({ action: "get_all" });
  if (!res || !res.dossiers) { pastille("err"); return; }
  const attente = await dbAll("queue");
  const bloques = new Set(attente.filter(o => o.action === "save_dossier").map(o => o.data.id));
  const supprimes = new Set(attente.filter(o => o.action === "delete_dossier").map(o => o.id));
  const locaux = dossiers.filter(d => bloques.has(d.id) || d.brouillon);
  const fusion = res.dossiers.filter(d => !bloques.has(d.id) && !supprimes.has(d.id) && !locaux.find(l => l.id === d.id)).concat(locaux);
  for (const d of dossiers) if (!fusion.find(x => x.id === d.id)) await dbDel("dossiers", d.id);
  for (const d of fusion) await dbPut("dossiers", d);
  dossiers = fusion;
  const anAtt = attente.filter(o => o.action === "save_annot").map(o => o.data);
  const anSup = new Set(attente.filter(o => o.action === "delete_annot").map(o => o.id));
  const nouv = (res.annots || []).filter(a => !anSup.has(a.id) && !anAtt.find(x => x.id === a.id)).concat(anAtt);
  for (const a of annots) if (!nouv.find(x => x.id === a.id)) await dbDel("annots", a.id);
  for (const a of nouv) await dbPut("annots", a);
  annots = nouv;
  dessinerProspections(); dessinerAnnots();
  pastille(attente.length ? "err" : "ok");
}
window.addEventListener("online", () => synchroniser());

// ---- Connexion ------------------------------------------------
let inscription = false;
function modeInscription(on) {
  inscription = on;
  $("lNomWrap").hidden = !on; $("lPlus").hidden = !on; $("lContact").hidden = !on;
  $("lOk").textContent = on ? "Créer mon compte" : "Connexion";
  $("lSwitch").textContent = on ? "J'ai déjà un compte" : "Créer un compte";
  $("lMdp").autocomplete = on ? "new-password" : "current-password";
  $("lErr").textContent = "";
}
$("lSwitch").onclick = () => modeInscription(!inscription);
$("lApiWrap").hidden = !!apiUrl;
$("lOk").onclick = async function () {
  const id = $("lId").value.trim(), mdp = $("lMdp").value, err = $("lErr");
  err.textContent = "";
  if (!id || !mdp) { err.textContent = "Remplissez tous les champs"; return; }
  const u = $("lApi").value.trim();
  if (u) { apiUrl = u; lss("pb5_api", u); }
  if (!apiUrl) { $("lApiWrap").hidden = false; err.textContent = "URL de l'API manquante"; return; }
  let corps = { action: "login", id, mdp };
  if (inscription) {
    const nom = $("lNom").value.trim(), invitation = $("lInvit").value.trim();
    const email = $("lEmail").value.trim(), tel = $("lTel").value.trim();
    if (!nom || !invitation || !email || !tel) { err.textContent = "Remplissez tous les champs"; return; }
    if (mdp !== $("lMdp2").value) { err.textContent = "Les mots de passe ne correspondent pas"; return; }
    corps = { action: "creer_compte", id, mdp, nom, invitation, email, tel };
  }
  const t = this.textContent; this.disabled = true; this.textContent = "Patientez...";
  const res = await apiPost(corps);
  this.disabled = false; this.textContent = t;
  if (!res) { err.textContent = "Serveur injoignable. La connexion demande du réseau."; return; }
  if (res.error === "bloque") { err.textContent = "Trop d'essais. Réessayez dans 15 minutes."; return; }
  if (res.error === "identifiants") { err.textContent = "Identifiant ou mot de passe incorrect"; return; }
  if (!res.success) { err.textContent = res.error || "Erreur du serveur"; return; }
  user = { id: res.id, nom: res.nom, token: res.token, sheetUrl: res.sheetUrl || "", email: res.email || "", tel: res.tel || "" };
  lss("pb5_user", user);
  ["lMdp", "lMdp2", "lInvit", "lNom", "lEmail", "lTel"].forEach(i => $(i).value = "");
  modeInscription(false);
  demarrer();
  toast("Bonjour " + user.nom);
};
["lMdp", "lMdp2", "lInvit"].forEach(i => $(i).addEventListener("keydown", e => { if (e.key === "Enter") $("lOk").click(); }));

async function deconnexion() {
  const n = await nbAttente();
  if (n && !confirm(n + " envoi(s) en attente seront perdus sur cet appareil. Se déconnecter quand même ?")) return;
  if (!n && !confirm("Se déconnecter ?")) return;
  for (const s of ["dossiers", "annots", "photos", "courriers", "queue"]) await tx(s, "readwrite", x => x.clear());
  lss("pb5_user", null); user = null; dossiers = []; annots = [];
  dessinerProspections(); dessinerAnnots(); verrouiller(); fermerSheet();
  $("login").hidden = false; $("lId").value = ""; $("lMdp").value = "";
}

async function demarrer() {
  $("login").hidden = true;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  dossiers = await dbAll("dossiers"); annots = await dbAll("annots");
  initCarte(); dessinerProspections(); dessinerAnnots();
  synchroniser();
}

// ---- Carte et couches -----------------------------------------
function wmts(layer, style, fmt, set, opts, base) {
  return L.tileLayer((base || GEOPF + "/wmts?") + "SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=" + layer + "&STYLE=" + encodeURIComponent(style) + "&TILEMATRIXSET=" + set + "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=" + fmt, Object.assign({ maxZoom: 20, attribution: "IGN-F/Géoplateforme" }, opts));
}
function gpu(layers) {
  return L.tileLayer.wms(GEOPF + "/wms-v/ows", { layers, format: "image/png", transparent: true, version: "1.3.0", maxZoom: 20, attribution: "Géoportail de l'Urbanisme" });
}
const COUCHES = [];
function definirCouches() {
  COUCHES.push(
    { id: "sat", nom: "Satellite", on: true, op: 1, l: wmts("ORTHOIMAGERY.ORTHOPHOTOS", "normal", "image/jpeg", "PM", { maxNativeZoom: 19 }) },
    { id: "ign", nom: "Plan IGN", on: false, op: 1, l: wmts("GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2", "normal", "image/png", "PM", { maxNativeZoom: 19 }) }
  );
  if (CFG.ignScanKey) COUCHES.push({ id: "scan", nom: "Carte IGN (SCAN 25)", on: false, op: 1, l: wmts("GEOGRAPHICALGRIDSYSTEMS.MAPS", "normal", "image/jpeg", "PM", { maxNativeZoom: 16 }, GEOPF + "/private/wmts?apikey=" + encodeURIComponent(CFG.ignScanKey) + "&") });
  COUCHES.push(
    { id: "foret", nom: "Forêts publiques", on: false, op: .7, l: wmts("FORETS.PUBLIQUES", "FORETS PUBLIQUES ONF", "image/png", "PM_3_16", { maxNativeZoom: 16, minZoom: 3 }) },
    { id: "urba", nom: "Urbanisme : zonages PLU", on: false, op: .6, l: gpu("zone_secteur") },
    { id: "presc", nom: "Urbanisme : prescriptions (dont EBC)", on: false, op: .7, l: gpu("prescription") },
    { id: "infos", nom: "Urbanisme : informations", on: false, op: .7, l: gpu("info") },
    { id: "cad", nom: "Cadastre", on: true, op: 1, l: wmts("CADASTRALPARCELS.PARCELLAIRE_EXPRESS", "PCI vecteur", "image/png", "PM", { maxNativeZoom: 19 }) }
  );
  // Si le style attendu du cadastre etait refuse, on bascule sur le service WMS.
  const cad = COUCHES.find(c => c.id === "cad");
  let bascule = false;
  cad.l.on("tileerror", () => {
    if (bascule || !navigator.onLine) return; bascule = true;
    const wms = L.tileLayer.wms(GEOPF + "/wms-r/wms", { layers: "CADASTRALPARCELS.PARCELLAIRE_EXPRESS", format: "image/png", transparent: true, version: "1.3.0", maxZoom: 20 });
    const actif = map.hasLayer(cad.l); if (actif) map.removeLayer(cad.l);
    cad.l = wms; if (actif) wms.addTo(map).setOpacity(cad.op);
  });
}
const prefs = () => ls("pb5_couches", {});
function appliquerCouches() {
  const p = prefs();
  COUCHES.forEach((c, i) => {
    const on = p[c.id] ? p[c.id].on : c.on, op = p[c.id] ? p[c.id].op : c.op;
    c.on = on; c.op = op; c.l.setOpacity(op); c.l.setZIndex(i + 1);
    if (on && !map.hasLayer(c.l)) c.l.addTo(map);
    if (!on && map.hasLayer(c.l)) map.removeLayer(c.l);
  });
  const eq = p.equipe ? p.equipe.on : true;
  if (eq && !map.hasLayer(gProspections)) gProspections.addTo(map);
  if (!eq && map.hasLayer(gProspections)) map.removeLayer(gProspections);
}
function sauverPref(id, v) { const p = prefs(); p[id] = Object.assign(p[id] || {}, v); lss("pb5_couches", p); appliquerCouches(); }

let gProspections, gAnnots, gTemp, gSel, carteOk = false;
function initCarte() {
  if (carteOk) return; carteOk = true;
  const v = ls("pb5_vue", null);
  map = L.map("map", { zoomControl: false, attributionControl: true, doubleClickZoom: true, tap: false }).setView(v ? v.c : CFG.centre, v ? v.z : CFG.zoom);
  map.attributionControl.setPrefix("");
  definirCouches();
  gProspections = L.featureGroup(); gAnnots = L.featureGroup().addTo(map); gTemp = L.featureGroup().addTo(map); gSel = L.featureGroup().addTo(map);
  appliquerCouches();
  map.on("moveend", () => lss("pb5_vue", { c: [map.getCenter().lat, map.getCenter().lng], z: map.getZoom() }));
  map.on("click", e => clicCarte(e.latlng));
  map.on("dragstart", () => { if (gpsSuit) { gpsSuit = false; majGpsBtn(); } });
  demarrerGps(false);
}

function panneauCouches() {
  const p = prefs();
  let h = "";
  [...COUCHES].reverse().forEach(c => {
    h += `<div class="couche"><label><input type="checkbox" data-c="${c.id}" ${c.on ? "checked" : ""}>${esc(c.nom)}</label><input type="range" aria-label="Opacité ${esc(c.nom)}" min="10" max="100" step="5" value="${Math.round(c.op * 100)}" data-o="${c.id}"></div>`;
  });
  h += `<div class="couche"><label><input type="checkbox" id="cEquipe" ${(p.equipe ? p.equipe.on : true) ? "checked" : ""}>Prospections de l'équipe</label></div>`;
  h += `<p class="note">Le zonage d'urbanisme n'apparaît qu'à partir d'un certain niveau de zoom et seulement pour les communes dont le document est publié sur le Géoportail de l'Urbanisme.</p>`;
  h += `<button class="btn btn2" id="cHorsLigne">Préparer cette zone pour le hors ligne</button><p class="note" id="cHlInfo">Télécharge la zone affichée pour les couches cochées, hors urbanisme.</p>`;
  ouvrirSheet("Couches", h);
  $("sheetCorps").querySelectorAll("[data-c]").forEach(i => i.onchange = () => sauverPref(i.dataset.c, { on: i.checked, op: COUCHES.find(c => c.id === i.dataset.c).op }));
  $("sheetCorps").querySelectorAll("[data-o]").forEach(i => i.oninput = () => { const c = COUCHES.find(x => x.id === i.dataset.o); sauverPref(c.id, { on: c.on, op: i.value / 100 }); });
  $("cEquipe").onchange = e => sauverPref("equipe", { on: e.target.checked });
  $("cHorsLigne").onclick = prechargerZone;
}
async function prechargerZone() {
  const couches = COUCHES.filter(c => c.on && c.l._url && /GetTile/i.test(c.l._url));
  const b = map.getBounds(), z0 = map.getZoom(), urls = [];
  for (let z = z0; z <= Math.min(z0 + 3, 17); z++) {
    const nw = map.project(b.getNorthWest(), z).divideBy(256).floor(), se = map.project(b.getSouthEast(), z).divideBy(256).floor();
    for (let x = nw.x; x <= se.x; x++) for (let y = nw.y; y <= se.y; y++) couches.forEach(c => urls.push(L.Util.template(c.l._url, { x, y, z, s: "" })));
  }
  const info = $("cHlInfo");
  if (urls.length > 2500) { info.textContent = "Zone trop grande (" + urls.length + " images). Zoomez puis recommencez."; return; }
  let fait = 0, ko = 0;
  for (let i = 0; i < urls.length; i += 8) {
    await Promise.all(urls.slice(i, i + 8).map(u => fetch(u, { mode: "no-cors" }).catch(() => { ko++; })));
    fait = Math.min(i + 8, urls.length);
    if ($("cHlInfo")) $("cHlInfo").textContent = fait + " / " + urls.length;
  }
  if ($("cHlInfo")) $("cHlInfo").textContent = ko ? ko + " images non téléchargées : réessayez avec plus de réseau." : "Zone prête pour le hors ligne.";
}

// ---- GPS ------------------------------------------------------
let gpsPoint, gpsCercle, ecouteursGps = [];
function demarrerGps(centrer) {
  if (!navigator.geolocation) { toast("GPS indisponible sur cet appareil", 1); return; }
  if (gpsWatch !== null) { if (centrer && gpsPos) map.setView(gpsPos, Math.max(map.getZoom(), 16)); return; }
  let premier = centrer;
  gpsWatch = navigator.geolocation.watchPosition(p => {
    gpsPos = L.latLng(p.coords.latitude, p.coords.longitude);
    if (!gpsPoint) {
      gpsCercle = L.circle(gpsPos, { radius: p.coords.accuracy, color: "#2f8cff", weight: 1, fillOpacity: .12, interactive: false }).addTo(map);
      gpsPoint = L.circleMarker(gpsPos, { radius: 8, color: "#fff", weight: 3, fillColor: "#2f8cff", fillOpacity: 1, interactive: false }).addTo(map);
    } else { gpsPoint.setLatLng(gpsPos); gpsCercle.setLatLng(gpsPos).setRadius(p.coords.accuracy); }
    if (premier || gpsSuit) { map.setView(gpsPos, premier ? Math.max(map.getZoom(), 16) : map.getZoom()); premier = false; }
    ecouteursGps.forEach(f => f(gpsPos, p.coords.accuracy));
  }, e => {
    // Un signal perdu en foret ne coupe pas le suivi : seul un refus l'arrete.
    if (e.code === 1) {
      toast("Autorisez la localisation pour voir votre position", 1);
      navigator.geolocation.clearWatch(gpsWatch); gpsWatch = null;
    }
  }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 });
}
function majGpsBtn() { $("btnGps").classList.toggle("on", gpsSuit); }
$("btnGps").onclick = () => { gpsSuit = !gpsSuit; majGpsBtn(); demarrerGps(true); if (gpsSuit && gpsPos) map.setView(gpsPos, Math.max(map.getZoom(), 16)); };

// ---- Cadenas et outils ----------------------------------------
function verrouiller() {
  if (outil === "trace" && traceActive) arreterTrace();
  choisirOutil(null); enAjout = false;
  document.body.classList.add("locked"); $("outils").hidden = true; $("cadIcone").textContent = "🔒";
  $("cadenas").setAttribute("aria-label", "Déverrouiller la saisie");
  bandeau(null);
  if (dossierCourant) { dossierCourant = null; fermerSheet(); }
}
$("cadenas").onclick = () => {
  if (document.body.classList.contains("locked")) {
    document.body.classList.remove("locked"); $("outils").hidden = false; $("cadIcone").textContent = "🔓";
    $("cadenas").setAttribute("aria-label", "Verrouiller la saisie");
    choisirOutil("info");
  } else verrouiller();
};
document.querySelectorAll("[data-outil]").forEach(b => b.onclick = () => choisirOutil(b.dataset.outil));
function bandeau(txt, boutons) {
  const b = $("bandeau");
  if (!txt) { b.hidden = true; b.innerHTML = ""; return; }
  b.hidden = false; b.innerHTML = `<div class="txt">${txt}</div>`;
  (boutons || []).forEach(([l, f]) => { const x = document.createElement("button"); x.textContent = l; x.onclick = f; b.appendChild(x); });
}
function choisirOutil(o) {
  if (outil === "trace" && traceActive && o !== "trace") { toast("Arrêtez d'abord la trace en cours", 1); return; }
  outil = o; gTemp.clearLayers(); ptsDessin = []; enAjout = false; bandeau(null);
  document.querySelectorAll("[data-outil]").forEach(b => b.classList.toggle("on", b.dataset.outil === o));
  if (o !== "info" && o !== "saisie") gSel.clearLayers();
  if (!map) return;
  map.doubleClickZoom[o === "mesure" || o === "polygone" ? "disable" : "enable"]();
  if (o === "mesure") { fermerSheet(); majMesure(); }
  if (o === "polygone") { fermerSheet(); majPolygone(); }
  if (o === "repere") { fermerSheet(); outilRepere(); }
  if (o === "trace") { fermerSheet(); majTrace(); }
  if (o === "info") bandeau("Touchez une parcelle pour voir ses informations.");
  if (o === "saisie") demarrerSaisie();
}
function clicCarte(ll) {
  if (document.body.classList.contains("locked")) return;
  if (outil === "info") infosParcelle(ll);
  else if (outil === "mesure") { ptsDessin.push(ll); majMesure(); }
  else if (outil === "polygone") { ptsDessin.push(ll); majPolygone(); }
  else if (outil === "saisie") choixParcelleSaisie(ll);
}

// ---- Geometrie ------------------------------------------------
let ptsDessin = [];
function longueur(p) { let t = 0; for (let i = 1; i < p.length; i++) t += L.latLng(p[i - 1]).distanceTo(p[i]); return t; }
function surface(p) {
  if (p.length < 3) return 0;
  const R = 6378137, r = Math.PI / 180; let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += (b.lng - a.lng) * r * (2 + Math.sin(a.lat * r) + Math.sin(b.lat * r)); }
  return Math.abs(s * R * R / 2);
}
const fmtLong = m => m >= 1000 ? (m / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " km" : Math.round(m) + " m";
const fmtSurf = m => m >= 10000 ? (m / 10000).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " ha" : Math.round(m) + " m²";
function dessinTemp(ferme) {
  gTemp.clearLayers();
  ptsDessin.forEach(p => L.circleMarker(p, { radius: 5, color: "#fff", weight: 2, fillColor: "#e67e22", fillOpacity: 1, interactive: false }).addTo(gTemp));
  if (ptsDessin.length > 1) (ferme && ptsDessin.length > 2 ? L.polygon : L.polyline)(ptsDessin, { color: "#e67e22", weight: 3, interactive: false }).addTo(gTemp);
}
function majMesure() {
  dessinTemp(true);
  const l = longueur(ptsDessin), s = surface(ptsDessin);
  bandeau(ptsDessin.length ? `<b>${fmtLong(l)}</b>${s ? " · surface <b>" + fmtSurf(s) + "</b>" : ""}` : "Touchez la carte pour mesurer.", [["Annuler le point", () => { ptsDessin.pop(); majMesure(); }], ["Effacer", () => { ptsDessin = []; majMesure(); }]]);
}
function majPolygone() {
  dessinTemp(true);
  const s = surface(ptsDessin);
  bandeau(ptsDessin.length ? `${ptsDessin.length} point(s)${s ? " · <b>" + fmtSurf(s) + "</b>" : ""}` : "Touchez la carte pour tracer le polygone.", [["Annuler le point", () => { ptsDessin.pop(); majPolygone(); }], ["Terminer", finirPolygone]]);
}
async function finirPolygone() {
  if (ptsDessin.length < 3) { toast("Il faut au moins 3 points", 1); return; }
  const nom = prompt("Nom du polygone", "Polygone " + new Date().toLocaleDateString("fr-FR"));
  if (nom === null) return;
  await ajouterAnnot("polygone", nom, ptsDessin.map(p => [+p.lat.toFixed(6), +p.lng.toFixed(6)]), fmtSurf(surface(ptsDessin)));
  ptsDessin = []; majPolygone();
}
async function outilRepere() {
  const finir = async () => {
    if (!gpsPos) { toast("Position GPS pas encore connue", 1); return; }
    const nom = prompt("Nom du repère", "Repère " + new Date().toLocaleDateString("fr-FR"));
    if (nom === null) return;
    await ajouterAnnot("repere", nom, [[+gpsPos.lat.toFixed(6), +gpsPos.lng.toFixed(6)]], "");
  };
  demarrerGps(false);
  bandeau("Repère à votre position GPS.", [["Poser le repère ici", finir]]);
}
let traceActive = null, verrouEcran = null;
function majTrace() {
  if (traceActive) bandeau(`Enregistrement : <b>${fmtLong(longueur(traceActive.pts))}</b>. Gardez l'appli ouverte et l'écran allumé.`, [["Arrêter", arreterTrace]]);
  else bandeau("Enregistrez votre parcours GPS.", [["Démarrer la trace", demarrerTrace]]);
}
async function demarrerTrace() {
  demarrerGps(false);
  traceActive = { pts: gpsPos ? [gpsPos] : [], ligne: L.polyline([], { color: "#e74c3c", weight: 4, interactive: false }).addTo(gTemp) };
  traceActive.ecoute = (p, prec) => {
    const t = traceActive; if (!t || prec > 50) return;
    const d = t.pts[t.pts.length - 1];
    if (!d || d.distanceTo(p) >= 5) { t.pts.push(p); t.ligne.setLatLngs(t.pts); majTrace(); }
  };
  ecouteursGps.push(traceActive.ecoute);
  try { if (navigator.wakeLock) verrouEcran = await navigator.wakeLock.request("screen"); } catch (e) {}
  majTrace();
}
async function arreterTrace() {
  const t = traceActive; traceActive = null;
  ecouteursGps = ecouteursGps.filter(f => f !== t.ecoute);
  try { if (verrouEcran) await verrouEcran.release(); } catch (e) {} verrouEcran = null;
  gTemp.clearLayers();
  if (t.pts.length > 1) {
    const nom = prompt("Nom de la trace", "Trace " + new Date().toLocaleDateString("fr-FR"));
    if (nom !== null) await ajouterAnnot("trace", nom, t.pts.map(p => [+p.lat.toFixed(6), +p.lng.toFixed(6)]), fmtLong(longueur(t.pts)));
  } else toast("Trace trop courte, non enregistrée", 1);
  if (outil === "trace") majTrace();
}
async function ajouterAnnot(type, nom, pts, mesure) {
  const a = { id: uuid(), type, nom, pts, mesure, auteur: user.nom, date: new Date().toLocaleDateString("fr-FR") };
  annots.push(a); await dbPut("annots", a); dessinerAnnots();
  toast("Enregistré : " + nom);
  enfiler({ action: "save_annot", data: a });
}
function dessinerAnnots() {
  if (!gAnnots) return;
  gAnnots.clearLayers();
  annots.forEach(a => {
    const lat = a.pts.map(p => L.latLng(p[0], p[1]));
    const couche = a.type === "repere" ? L.marker(lat[0], { icon: L.divIcon({ html: "📌", className: "", iconSize: [24, 24], iconAnchor: [6, 22] }) })
      : a.type === "trace" ? L.polyline(lat, { color: "#e74c3c", weight: 3 })
      : L.polygon(lat, { color: "#ff9f1c", weight: 2, fillOpacity: .15 });
    couche.on("click", e => {
      L.DomEvent.stopPropagation(e);
      const verrou = document.body.classList.contains("locked");
      ouvrirSheet(a.nom, `<div class="ligne"><span>Type</span><span>${esc(a.type)}</span></div>${a.mesure ? `<div class="ligne"><span>Mesure</span><span>${esc(a.mesure)}</span></div>` : ""}<div class="ligne"><span>Par</span><span>${esc(a.auteur)} · ${esc(a.date)}</span></div>${a.type === "repere" ? `<div class="ligne"><span>Coordonnées</span><span>${a.pts[0][0]}, ${a.pts[0][1]}</span></div>` : ""}${verrou ? "" : `<button class="btn danger" id="aSup">Supprimer</button>`}`);
      if (!verrou) $("aSup").onclick = async () => {
        if (!confirm("Supprimer « " + a.nom + " » ?")) return;
        annots = annots.filter(x => x.id !== a.id); await dbDel("annots", a.id); dessinerAnnots(); fermerSheet();
        enfiler({ action: "delete_annot", id: a.id });
      };
    });
    couche.addTo(gAnnots);
  });
}

// ---- Interrogation des services publics -----------------------
async function getJson(url) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), 15000);
  try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error("http " + r.status); return await r.json(); } finally { clearTimeout(t); }
}
const geomParam = g => encodeURIComponent(JSON.stringify(g));
// Retourne la parcelle, null si aucune, et leve une erreur si le service est injoignable.
async function chercherParcelle(ll) {
  const pt = { type: "Point", coordinates: [+ll.lng.toFixed(7), +ll.lat.toFixed(7)] };
  const r = await getJson(`${APICARTO}/cadastre/parcelle?source_ign=PCI&geom=${geomParam(pt)}`);
  const f = (r.features || [])[0];
  return f ? depuisFeature(f, ll) : null;
}
function depuisFeature(f, ll) {
  const p = f.properties || {};
  const insee = p.code_insee || ((p.code_dep || "") + (p.code_com || ""));
  const prefixe = String(p.com_abs || "000").padStart(3, "0"), section = String(p.section || "").padStart(2, "0"), numero = String(p.numero || "").padStart(4, "0");
  return {
    idu: p.idu || insee + prefixe + section + numero, insee, commune: p.nom_com || "", prefixe, section, numero,
    feuille: p.feuille || "", echelle: p.echelle || "", arrondissement: p.code_arr || "", contenance: Number(p.contenance) || 0,
    lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6), geom: simplifier(f.geometry), proprietaires: [], proprioEtat: "attente", zonage: [], zonageManquants: null, etat: "ok"
  };
}
// Une cellule de Sheet est limitee a 50 000 caracteres.
function simplifier(g) {
  if (!g) return null;
  const arr = c => typeof c[0] === "number" ? [+c[0].toFixed(6), +c[1].toFixed(6)] : c.map(arr);
  const out = { type: g.type, coordinates: arr(g.coordinates) };
  return JSON.stringify(out).length > 45000 ? null : out;
}
// Geometrie allegee pour tenir dans une URL de requete.
function geomRequete(p) {
  if (!p.geom) return { type: "Point", coordinates: [p.lng, p.lat] };
  const anneau = p.geom.type === "MultiPolygon" ? p.geom.coordinates[0][0] : p.geom.coordinates[0];
  if (anneau.length <= 60 && p.geom.type === "Polygon") return p.geom;
  const pas = Math.ceil(anneau.length / 50), r = anneau.filter((_, i) => i % pas === 0);
  if (r.length < 3) return p.geom;
  r.push(r[0]);
  return { type: "Polygon", coordinates: [r] };
}
const SOURCES_NATURE = [
  ["natura-habitat", "Natura 2000 (Directive Habitats)"], ["natura-oiseaux", "Natura 2000 (Directive Oiseaux)"],
  ["znieff1", "ZNIEFF type 1"], ["znieff2", "ZNIEFF type 2"], ["pn", "Parc national"], ["pnr", "Parc naturel régional"],
  ["rnn", "Réserve naturelle nationale"], ["rnc", "Réserve naturelle de Corse"], ["rncf", "Réserve de chasse et de faune sauvage"]
];
const dedoublonner = l => { const s = new Set(); return l.filter(z => { const k = z.type + "|" + z.nom; if (s.has(k)) return false; s.add(k); return true; }); };
async function chargerZonage(p) {
  const g = geomParam(geomRequete(p)), manquants = [], zones = [];
  const nature = SOURCES_NATURE.map(async ([res, lib]) => {
    try {
      const r = await getJson(`${APICARTO}/nature/${res}?geom=${g}`);
      (r.features || []).forEach(f => { const x = f.properties || {}; zones.push({ type: lib, nom: x.sitename || x.nom || x.nom_site || "", url: x.url || x.url_fiche || "", reglementaire: true }); });
    } catch (e) { manquants.push(lib); }
  });
  const gpus = [
    ["zone-urba", "Zonage PLU", x => [x.libelle, x.libelong].filter(Boolean).join(" : "), false],
    ["secteur-cc", "Carte communale", x => x.libelle || "", false],
    ["prescription-surf", "Prescription", x => x.libelle || x.txt || "", false],
    ["info-surf", "Information d'urbanisme", x => x.libelle || x.txt || "", false],
    ["assiette-sup-s", "Servitude d'utilité publique", x => [x.suptype, x.nomsuplitt].filter(Boolean).join(" : "), false]
  ].map(async ([res, lib, nomf]) => {
    try {
      const r = await getJson(`${APICARTO}/gpu/${res}?geom=${g}`);
      (r.features || []).forEach(f => {
        const x = f.properties || {};
        const ebc = res === "prescription-surf" && (String(x.typepsc) === "01" || /espaces?\s+bois/i.test(String(x.libelle || "") + String(x.txt || "")));
        zones.push({ type: ebc ? "Espace boisé classé (EBC)" : lib, nom: nomf(x), reglementaire: ebc || res === "assiette-sup-s" });
      });
    } catch (e) { manquants.push(lib); }
  });
  await Promise.all(nature.concat(gpus));
  p.zonage = dedoublonner(zones); p.zonageManquants = manquants;
  return p;
}
async function chargerProprietaire(p) {
  if (!apiUrl || !user) return p;
  const r = await apiPost({ action: "get_proprietaire", idu: p.idu, insee: p.insee });
  if (!r) { p.proprioEtat = "attente"; return p; }
  if (r.proprietaires && r.proprietaires.length) { p.proprietaires = r.proprietaires; p.proprioEtat = "ok"; }
  else p.proprioEtat = r.etat || "non_trouve";
  return p;
}
function htmlZonage(p) {
  if (p.etat !== "ok") return `<p class="note">Sera identifié au retour du réseau.</p>`;
  if (p.zonageManquants === null) return `<p class="note">Recherche en cours…</p>`;
  let h = p.zonage.length ? p.zonage.map(z => `<div class="zone"><b>${esc(z.type)}</b>${z.nom ? "<br>" + esc(z.nom) : ""}${/^https?:/.test(z.url || "") ? `<br><a href="${esc(z.url)}" target="_blank" rel="noopener">Voir la fiche</a>` : ""}</div>`).join("") : `<p class="note">Aucun zonage trouvé dans les bases interrogées.</p>`;
  if (p.zonageManquants.length) h += `<div class="alerte">Non vérifié, service injoignable : ${esc(p.zonageManquants.join(", "))}.</div>`;
  h += `<p class="note">Résultat automatique à confirmer. Les arrêtés de protection de biotope ne sont pas interrogés directement : ils n'apparaissent que s'ils figurent dans les servitudes du Géoportail de l'Urbanisme.</p>`;
  return h;
}
function surligner(p) {
  gSel.clearLayers();
  if (p && p.geom) L.geoJSON(p.geom, { style: { color: "#ffe14d", weight: 3, fillOpacity: .15 }, interactive: false }).addTo(gSel);
  else if (p) L.circleMarker([p.lat, p.lng], { radius: 9, color: "#ffe14d", weight: 3, fillOpacity: .2, interactive: false }).addTo(gSel);
}
function cherchePar(idu) {
  for (const d of dossiers) { const p = d.parcelles.find(x => x.idu === idu); if (p) return d; }
  return null;
}
function htmlCadastre(p) {
  const l = (a, b) => b ? `<div class="ligne"><span>${a}</span><span>${esc(b)}</span></div>` : "";
  return l("Commune", p.commune) + l("Code INSEE", p.insee) + l("Préfixe", p.prefixe) + l("Section", p.section) + l("Numéro", p.numero) + l("Identifiant", p.idu) + l("Contenance", p.contenance ? p.contenance.toLocaleString("fr-FR") + " m² (" + ha(p.contenance) + ")" : "") + l("Feuille", p.feuille) + l("Échelle d'origine", p.echelle ? "1/" + p.echelle : "") + l("Arrondissement", p.arrondissement) + l("Coordonnées", p.lat + ", " + p.lng);
}
let parcelleInfo = null;
async function infosParcelle(ll) {
  bandeau("Recherche de la parcelle…");
  let p;
  try { p = await chercherParcelle(ll); } catch (e) { bandeau(null); toast("Cadastre injoignable : réseau insuffisant", 1); return; }
  bandeau(null);
  if (outil !== "info") return;
  if (!p) { toast("Aucune parcelle à cet endroit", 1); return; }
  parcelleInfo = p; surligner(p);
  const rendre = () => {
    if (parcelleInfo !== p) return;
    const d = cherchePar(p.idu);
    ouvrirSheet(`${p.commune} · ${p.section} ${p.numero}`, htmlCadastre(p) + (d ? `<div class="alerte">Déjà dans le dossier ${esc(d.nom)}, par ${esc(d.auteur)}.</div>` : "") + `<h3>Zonage réglementaire</h3>` + htmlZonage(p));
  };
  rendre();
  await chargerZonage(p); rendre();
}

// ---- Dossiers -------------------------------------------------
function monContact() { return { nom: user.nom, email: user.email || "", tel: user.tel || "" }; }
function nouveauDossier(p) {
  const code = codeDossier();
  return {
    id: uuid(), code, nom: (p.etat === "ok" ? slug(p.commune) : "A-IDENTIFIER") + "-" + code, commune: p.commune, insee: p.insee,
    auteur: user.nom, auteurId: user.id, cree: new Date().toLocaleDateString("fr-FR"), statut: "PROSPECTE",
    donnees: { _contact: monContact() }, parcelles: [p], enregistre: false, brouillon: true, driveUrl: ""
  };
}
async function demarrerSaisie() {
  if (parcelleInfo && !$("sheet").hidden) {
    const p = parcelleInfo; parcelleInfo = null;
    await creerDossierAvec(p);
  } else {
    fermerSheet(); gSel.clearLayers();
    bandeau("Touchez la première parcelle du dossier.");
  }
}
async function identifierOuProvisoire(ll) {
  let p;
  try { p = await chercherParcelle(ll); if (!p) { toast("Aucune parcelle à cet endroit", 1); return null; } }
  catch (e) {
    const id = "NON-IDENTIFIEE-" + codeDossier();
    p = { idu: id, insee: "", commune: "", prefixe: "", section: "", numero: "", contenance: 0, lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6), geom: null, proprietaires: [], proprioEtat: "attente", zonage: [], zonageManquants: null, etat: "a_identifier" };
    toast("Pas de réseau : point conservé, parcelle identifiée plus tard");
  }
  return p;
}
function avertirDoublon(p, sauf) {
  const d = p.etat === "ok" && dossiers.find(x => x !== sauf && x.parcelles.some(y => y.idu === p.idu));
  return !d || confirm(`Parcelle déjà prospectée par ${d.auteur} le ${d.cree} (dossier ${d.nom}). Continuer ?`);
}
async function choixParcelleSaisie(ll) {
  if (dossierCourant && !enAjout) return;
  bandeau("Recherche de la parcelle…");
  const p = await identifierOuProvisoire(ll);
  if (!p) { bandeau(enAjout ? ajoutTexte() : "Touchez la première parcelle du dossier.", enAjout ? ajoutBoutons() : null); return; }
  if (enAjout) await ajouterParcelle(p); else await creerDossierAvec(p);
}
async function creerDossierAvec(p) {
  if (!avertirDoublon(p)) { bandeau("Touchez la première parcelle du dossier."); return; }
  const d = nouveauDossier(p);
  dossiers.push(d); dossierCourant = d;
  await dbPut("dossiers", d);
  bandeau(null); surligner(p); afficherDossier();
  await completerParcelle(d, p);
}
async function completerParcelle(d, p) {
  if (p.etat !== "ok") return;
  await Promise.all([chargerZonage(p), chargerProprietaire(p)]);
  await dbPut("dossiers", d);
  if (dossierCourant === d) rafraichirDossierPartiel();
}
const ajoutTexte = () => `Touchez les parcelles à ajouter à <b>${esc(dossierCourant.nom)}</b> (${dossierCourant.parcelles.length}).`;
const ajoutBoutons = () => [["Terminer", finirAjout]];
function modeAjout() {
  enAjout = true; fermerSheet(); dessinerParcellesCourantes();
  bandeau(ajoutTexte(), ajoutBoutons());
}
function finirAjout() { enAjout = false; bandeau(null); afficherDossier(); }
function dessinerParcellesCourantes() {
  gSel.clearLayers();
  (dossierCourant ? dossierCourant.parcelles : []).forEach(p => {
    if (p.geom) L.geoJSON(p.geom, { style: { color: "#ffe14d", weight: 3, fillOpacity: .18 }, interactive: false }).addTo(gSel);
    else L.circleMarker([p.lat, p.lng], { radius: 9, color: "#ffe14d", weight: 3, fillOpacity: .2, interactive: false }).addTo(gSel);
  });
}
async function ajouterParcelle(p) {
  const d = dossierCourant;
  if (d.parcelles.some(x => x.idu === p.idu)) { toast("Déjà dans ce dossier"); bandeau(ajoutTexte(), ajoutBoutons()); return; }
  if (!avertirDoublon(p, d)) { bandeau(ajoutTexte(), ajoutBoutons()); return; }
  d.parcelles.push(p); d.brouillon = true;
  await dbPut("dossiers", d);
  dessinerParcellesCourantes(); bandeau(ajoutTexte(), ajoutBoutons());
  toast(p.etat === "ok" ? `Parcelle ${p.section} ${p.numero} ajoutée` : "Point ajouté");
  await completerParcelle(d, p);
}
async function supprimerParcelle(idu) {
  const d = dossierCourant, p = d.parcelles.find(x => x.idu === idu);
  if (d.parcelles.length === 1) { supprimerDossier(); return; }
  if (!confirm(`Retirer la parcelle ${p.section} ${p.numero} du dossier ?`)) return;
  d.parcelles = d.parcelles.filter(x => x.idu !== idu); d.brouillon = true;
  await dbPut("dossiers", d); dessinerParcellesCourantes(); afficherDossier();
}
async function supprimerDossier() {
  const d = dossierCourant;
  if (!confirm(`Supprimer le dossier ${d.nom} et tout son contenu ?`)) return;
  dossiers = dossiers.filter(x => x !== d);
  await dbDel("dossiers", d.id);
  for (const x of await dbAll("photos")) if (x.dossierId === d.id) await dbDel("photos", x.id);
  for (const x of await dbAll("courriers")) if (x.dossierId === d.id) await dbDel("courriers", x.id);
  for (const o of await dbAll("queue")) if (o.dossierId === d.id || (o.data && o.data.id === d.id)) await dbDel("queue", o.n);
  dossierCourant = null; gSel.clearLayers(); fermerSheet(); dessinerProspections();
  if (outil === "saisie") choisirOutil("info");
  enfiler({ action: "delete_dossier", id: d.id });
  toast("Dossier supprimé");
}

function peutEditer() { return !document.body.classList.contains("locked"); }
function htmlChamp(c, d) {
  const v = d.donnees[c.k] || [], autre = d.donnees[c.k + "_autre"] || "";
  return `<div class="groupe"><label>${esc(c.l)}</label><div class="choix" data-champ="${c.k}" ${c.multi ? 'data-multi="1"' : ""}>${c.o.map(o => `<button type="button" class="${v.includes(o) ? "on" : ""}" data-v="${esc(o)}">${esc(o)}</button>`).join("")}</div>${c.autre ? `<input class="autre" data-autre="${c.k}" placeholder="Autre" aria-label="${esc(c.l)} : autre" value="${esc(autre)}">` : ""}</div>`;
}
function htmlProprio(p) {
  if (p.etat !== "ok") return `<small>Propriétaire : au retour du réseau</small>`;
  if (p.proprietaires.length) return `<small>Propriétaire : ${esc(p.proprietaires.map(x => x.nom).join(", "))}</small>`;
  const m = { attente: "recherche…", non_trouve: "non trouvé", non_configure: "fichier non installé" };
  return `<small>Propriétaire : ${m[p.proprioEtat] || "non trouvé"}</small>`;
}
function htmlParcelleLigne(p, d, edit) {
  const titre = p.etat === "ok" ? `${esc(p.commune)} · ${esc(p.section)} ${esc(p.numero)}` : `Point à identifier (${p.lat}, ${p.lng})`;
  return `<div class="parcelle"><div class="t"><b>${titre}</b><small>${p.contenance ? ha(p.contenance) : ""}${d.parcelles[0] === p ? " · parcelle principale" : ""}</small>${htmlProprio(p)}</div>${edit ? `<button data-sup="${esc(p.idu)}" aria-label="Retirer la parcelle">🗑</button>` : ""}</div>`;
}
function htmlZoneDossier(d) {
  return d.parcelles.map(p => (d.parcelles.length > 1 ? `<p class="note"><b>${esc(p.section)} ${esc(p.numero)}</b></p>` : "") + htmlZonage(p)).join("");
}
async function afficherDossier() {
  const d = dossierCourant; if (!d) return;
  const edit = peutEditer(), P = d.parcelles[0];
  let h = "";
  if (d.parcelles.length && d.auteurId !== user.id) h += `<div class="alerte">Dossier de ${esc(d.auteur)}.</div>`;
  h += `<h3>Statut</h3><select id="dStatut" ${edit ? "" : "disabled"}>${Object.keys(STATUTS).map(k => `<option value="${k}" ${k === d.statut ? "selected" : ""}>${STATUTS[k][0]}</option>`).join("")}</select>`;
  h += `<h3>Parcelles (${d.parcelles.length})</h3><div id="dParcelles">${d.parcelles.map(p => htmlParcelleLigne(p, d, edit)).join("")}</div>`;
  if (edit) h += `<button class="plus" id="dPlus">+ Ajouter une parcelle</button>`;
  h += `<h3>Informations cadastrales</h3>${htmlCadastre(P)}`;
  h += edit ? `<div class="groupe" style="margin-top:10px"><label for="dLieuDit">Lieu-dit (repris dans le courrier)</label><input id="dLieuDit" value="${esc(d.donnees.lieu_dit || "")}"></div>` : (d.donnees.lieu_dit ? `<div class="ligne"><span>Lieu-dit</span><span>${esc(d.donnees.lieu_dit)}</span></div>` : "");
  if (edit) {
    THEMES.forEach(t => {
      h += `<h3>${esc(t.titre)}</h3>` + t.champs.map(c => htmlChamp(c, d)).join("");
      if (t.photos) h += `<button class="btn btn2" id="dPhoto" type="button">📷 Prendre des photos</button><div class="photos" id="dPhotos"></div>`;
    });
    h += `<h3>Zonage réglementaire</h3><div id="dZonage">${htmlZoneDossier(d)}</div>`;
    h += `<h3>Réglementation communale</h3>`;
    REGLES.forEach(r => {
      const v = d.donnees[r.k] || "";
      h += `<div class="groupe"><label>${esc(r.l)}</label><div class="choix" data-regle="${r.k}"><button type="button" class="${v === "OUI" ? "on" : ""}" data-v="OUI">Oui</button><button type="button" class="${v === "NON" ? "on" : ""}" data-v="NON">Non</button></div><input class="autre" data-detail="${r.k}" placeholder="${esc(r.q)}" aria-label="${esc(r.l)} : ${esc(r.q)}" value="${esc(d.donnees[r.k + "_detail"] || "")}" ${v === "OUI" ? "" : "hidden"}></div>`;
    });
    h += `<div class="groupe"><label for="dRegAutre">Autre</label><input id="dRegAutre" value="${esc(d.donnees.regle_autre || "")}"></div>`;
    h += `<button class="btn" id="dSave">💾 Enregistrer</button>`;
  } else {
    THEMES.forEach(t => { h += `<h3>${esc(t.titre)}</h3>` + (t.champs.map(c => { const v = valeurLisible(d, c.k); return v ? `<div class="ligne"><span>${esc(c.l)}</span><span>${esc(v)}</span></div>` : ""; }).join("") || `<p class="note">Rien de saisi.</p>`); if (t.photos) h += `<div class="photos" id="dPhotos"></div>`; });
    h += `<h3>Zonage réglementaire</h3><div id="dZonage">${htmlZoneDossier(d)}</div><h3>Réglementation communale</h3>` + (reglesLisibles(d).map(x => `<div class="ligne"><span>${esc(x[0])}</span><span>${esc(x[1])}</span></div>`).join("") || `<p class="note">Rien de saisi.</p>`);
    h += `<p class="note">Déverrouillez le cadenas pour modifier ce dossier.</p>`;
  }
  h += `<h3>Courriers</h3><div id="dCourriers"></div>`;
  if (d.driveUrl) h += `<a class="btn btn2" style="text-align:center;text-decoration:none" href="${esc(d.driveUrl)}" target="_blank" rel="noopener">Ouvrir le dossier dans Drive</a>`;
  if (edit) h += `<button class="btn danger" id="dSup">Supprimer le dossier</button>`;
  ouvrirSheet(d.nom, h, true);
  brancherDossier(d, edit);
  dessinerParcellesCourantes();
  afficherPhotos(d, edit); afficherCourriers(d);
}
function rafraichirDossierPartiel() {
  const d = dossierCourant, el = $("dZonage"), pl = $("dParcelles");
  if (el) el.innerHTML = htmlZoneDossier(d);
  if (pl) { pl.innerHTML = d.parcelles.map(p => htmlParcelleLigne(p, d, peutEditer())).join(""); }
}
function brancherDossier(d, edit) {
  const c = $("sheetCorps");
  const maj = () => { d.brouillon = true; dbPut("dossiers", d); };
  $("dStatut").onchange = e => { d.statut = e.target.value; maj(); };
  if (!edit) return;
  $("dPlus").onclick = modeAjout;
  $("dSup").onclick = supprimerDossier;
  $("dSave").onclick = () => enregistrerDossier(d);
  $("dPhoto").onclick = () => $("fichierPhoto").click();
  c.addEventListener("click", e => {
    const s = e.target.closest("[data-sup]"); if (s) { supprimerParcelle(s.dataset.sup); return; }
    const b = e.target.closest(".choix button"); if (!b) return;
    const g = b.parentElement;
    if (g.dataset.regle) {
      const k = g.dataset.regle, deja = b.classList.contains("on");
      g.querySelectorAll("button").forEach(x => x.classList.remove("on"));
      if (!deja) b.classList.add("on");
      d.donnees[k] = deja ? "" : b.dataset.v;
      c.querySelector(`[data-detail="${k}"]`).hidden = d.donnees[k] !== "OUI";
    } else {
      if (!g.dataset.multi) g.querySelectorAll("button").forEach(x => { if (x !== b) x.classList.remove("on"); });
      b.classList.toggle("on");
      d.donnees[g.dataset.champ] = [...g.querySelectorAll("button.on")].map(x => x.dataset.v);
    }
    maj();
  });
  c.addEventListener("input", e => {
    const t = e.target;
    if (t.dataset.autre) d.donnees[t.dataset.autre + "_autre"] = t.value;
    else if (t.dataset.detail) d.donnees[t.dataset.detail + "_detail"] = t.value;
    else if (t.id === "dRegAutre") d.donnees.regle_autre = t.value;
    else if (t.id === "dLieuDit") d.donnees.lieu_dit = t.value;
    else return;
    maj();
  });
}
function valeurLisible(d, k) {
  const v = [].concat(d.donnees[k] || []), a = d.donnees[k + "_autre"];
  if (a) v.push(a);
  return v.join(" + ");
}
function reglesLisibles(d) {
  const out = [];
  REGLES.forEach(r => { const v = d.donnees[r.k]; if (v) out.push([r.l, v + (v === "OUI" && d.donnees[r.k + "_detail"] ? " : " + d.donnees[r.k + "_detail"] : "")]); });
  if (d.donnees.regle_autre) out.push(["Autre", d.donnees.regle_autre]);
  return out;
}

// ---- Photos ---------------------------------------------------
$("fichierPhoto").onchange = async e => {
  const fichiers = [...e.target.files]; e.target.value = "";
  const d = dossierCourant; if (!d) return;
  for (const f of fichiers) {
    try {
      const blob = await reduirePhoto(f), n = (await dbAll("photos")).filter(x => x.dossierId === d.id).length + 1;
      const id = uuid();
      await dbPut("photos", { id, dossierId: d.id, nom: `${d.nom}_photo_${String(n).padStart(2, "0")}_${id.slice(0, 4)}.jpg`, blob, envoye: false });
    } catch (err) { toast("Photo illisible", 1); }
  }
  d.brouillon = true; dbPut("dossiers", d);
  afficherPhotos(d, true);
};
function reduirePhoto(f) {
  return new Promise((ok, ko) => {
    const u = URL.createObjectURL(f), i = new Image();
    i.onload = () => {
      const m = 1600, r = Math.min(1, m / Math.max(i.width, i.height)), c = document.createElement("canvas");
      c.width = Math.round(i.width * r); c.height = Math.round(i.height * r);
      c.getContext("2d").drawImage(i, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u);
      c.toBlob(b => b ? ok(b) : ko(new Error("photo")), "image/jpeg", .8);
    };
    i.onerror = () => { URL.revokeObjectURL(u); ko(new Error("photo")); };
    i.src = u;
  });
}
async function afficherPhotos(d, edit) {
  const el = $("dPhotos"); if (!el) return;
  const ph = (await dbAll("photos")).filter(x => x.dossierId === d.id);
  el.innerHTML = "";
  ph.forEach(x => {
    const div = document.createElement("div"), img = document.createElement("img");
    img.src = URL.createObjectURL(x.blob); img.alt = "Photo du peuplement"; div.appendChild(img);
    if (edit) {
      const b = document.createElement("button"); b.textContent = "✕"; b.type = "button"; b.setAttribute("aria-label", "Supprimer la photo");
      b.onclick = async () => {
        if (!confirm("Supprimer cette photo ?")) return;
        await dbDel("photos", x.id);
        for (const o of await dbAll("queue")) if (o.ref === x.id) await dbDel("queue", o.n);
        if (x.envoye) enfiler({ action: "delete_file", dossierId: d.id, dossierNom: d.nom, nom: x.nom });
        afficherPhotos(d, true);
      };
      div.appendChild(b);
    }
    el.appendChild(div);
  });
}

// ---- Enregistrement -------------------------------------------
function pourServeur(d) {
  const { brouillon, enregistre, ...reste } = d;
  return JSON.parse(JSON.stringify(Object.assign(reste, { lisible: lisibleDossier(d) })));
}
function lisibleDossier(d) {
  const o = {};
  THEMES.forEach(t => t.champs.forEach(c => { o[c.k] = valeurLisible(d, c.k); }));
  REGLES.forEach(r => { const v = d.donnees[r.k]; o[r.k] = v ? v + (v === "OUI" && d.donnees[r.k + "_detail"] ? " : " + d.donnees[r.k + "_detail"] : "") : ""; });
  o.regle_autre = d.donnees.regle_autre || "";
  o.lieu_dit = d.donnees.lieu_dit || "";
  return o;
}
async function enregistrerDossier(d) {
  d.brouillon = false; d.enregistre = true; d.modifie = new Date().toISOString();
  if (d.auteurId === user.id) d.donnees._contact = monContact();
  await dbPut("dossiers", d);
  const lettres = await genererCourriers(d);
  await dbPut("queue", { action: "save_dossier", data: pourServeur(d), dossierId: d.id });
  for (const x of await dbAll("photos")) if (x.dossierId === d.id && !x.envoye) {
    await dbPut("queue", { action: "save_file", source: "photos", ref: x.id, dossierId: d.id, dossierNom: d.nom });
    x.envoye = true; await dbPut("photos", x);
  }
  for (const l of lettres) await dbPut("queue", { action: "save_file", source: "courriers", ref: l.id, dossierId: d.id, dossierNom: d.nom });
  dessinerProspections();
  afficherCourriers(d);
  const ok = await vider();
  toast(ok ? "Dossier enregistré et envoyé" : "Dossier enregistré, envoi dès que possible");
}

// ---- Courrier Word (rempli a partir du modele de la societe) --
const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
function runsDe(p) { return [...p.childNodes].filter(n => n.namespaceURI === NS_W && n.localName === "r"); }
function texteRun(r, t) { const x = r.getElementsByTagNameNS(NS_W, "t")[0]; x.textContent = t; x.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve"); }
function retirer(r, nom) { [...r.getElementsByTagNameNS(NS_W, nom)].forEach(n => n.remove()); }
// Une valeur absente garde le texte du modele, surligne pour ne pas partir ainsi.
function remplir(r, valeur, attente) {
  if (valeur) { texteRun(r, valeur); retirer(r, "i"); retirer(r, "iCs"); return; }
  texteRun(r, attente);
  let pr = r.getElementsByTagNameNS(NS_W, "rPr")[0];
  if (!pr) { pr = r.ownerDocument.createElementNS(NS_W, "w:rPr"); r.insertBefore(pr, r.firstChild); }
  const h = r.ownerDocument.createElementNS(NS_W, "w:highlight"); h.setAttributeNS(NS_W, "w:val", "yellow"); pr.appendChild(h);
}
function liste(l) { return l.length < 2 ? (l[0] || "") : l.slice(0, -1).join(", ") + " et " + l[l.length - 1]; }
const sansZero = v => String(v || "").replace(/^0+(?=.)/, "");
let modeleCourrier = null;
async function chargerModele() {
  if (!modeleCourrier) { const r = await fetch("modele_courrier.docx"); if (!r.ok) throw new Error("modele"); modeleCourrier = await r.arrayBuffer(); }
  return modeleCourrier;
}
async function docxCourrier(d, proprio, parcelles) {
  const z = await JSZip.loadAsync(await chargerModele());
  const xml = new DOMParser().parseFromString(await z.file("word/document.xml").async("string"), "application/xml");
  const ps = [...xml.getElementsByTagNameNS(NS_W, "p")];
  const trouve = debut => { const p = ps.find(x => x.textContent.trim().startsWith(debut)); if (!p) throw new Error("Modèle de courrier modifié : " + debut); return runsDe(p); };
  const contact = (d.donnees && d.donnees._contact) || {};
  const communes = [...new Set(parcelles.map(p => p.commune).filter(Boolean))], commune = liste(communes);

  remplir(trouve("Prénom et NOM")[0], proprio && proprio.nom, "Prénom et NOM");
  remplir(trouve("Adresse")[0], proprio && proprio.adresse, "Adresse");
  remplir(trouve("Code postale")[0], proprio && [proprio.cp, proprio.ville].filter(Boolean).join(" "), "Code postal et ville");

  const fait = trouve("Fait à");
  texteRun(fait[1], new Date().toLocaleDateString("fr-FR")); fait.slice(2).forEach(r => texteRun(r, ""));

  remplir(trouve("Gestionnaire forestier au sein")[1], commune, "[commune]");

  // Parcelles regroupees par section : « 12 et 13 de la section A et 14 de la section B ».
  const parSection = new Map();
  parcelles.forEach(p => { const s = sansZero(p.section); if (!parSection.has(s)) parSection.set(s, []); parSection.get(s).push(sansZero(p.numero)); });
  const groupes = [...parSection.entries()], dernier = groupes[groupes.length - 1], plusieurs = parcelles.length > 1;
  const debutNums = groupes.slice(0, -1).map(([s, n]) => liste(n) + " de la section " + s).concat(liste(dernier[1])).join(" et ");
  const r = trouve("Notre société accompagne");
  if (plusieurs) { texteRun(r[1], "s"); texteRun(r[2], " parcelles"); }
  remplir(r[4], debutNums, "[parcelle]");
  remplir(r[8], dernier[0], "[section]");
  texteRun(r[9], " ");
  remplir(r[12], d.donnees.lieu_dit, "[lieu-dit]");
  remplir(r[15], commune ? " " + commune : "", " [commune]");
  const fin = r[16].getElementsByTagNameNS(NS_W, "t")[0];
  fin.textContent = fin.textContent.replace("situées", plusieurs ? "situées" : "située");

  remplir(trouve("E-mail")[1], contact.email, "[e-mail du gestionnaire]");
  remplir(trouve("Téléphone")[1], contact.tel, "[téléphone du gestionnaire]");
  remplir(trouve("[Nom du gestionnaire]")[0], contact.nom, "[Nom du gestionnaire]");

  z.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + new XMLSerializer().serializeToString(xml.documentElement));
  return z.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", compression: "DEFLATE" });
}
// Un courrier par proprietaire, avec toutes ses parcelles du dossier.
async function genererCourriers(d) {
  const groupes = new Map();
  d.parcelles.filter(p => p.etat === "ok").forEach(p => {
    const ps = p.proprietaires.length ? p.proprietaires : [null];
    ps.forEach(o => { const k = o ? o.nom : ""; if (!groupes.has(k)) groupes.set(k, { o, parcelles: [] }); groupes.get(k).parcelles.push(p); });
  });
  for (const x of await dbAll("courriers")) if (x.dossierId === d.id) await dbDel("courriers", x.id);
  const out = [];
  for (const [k, g] of groupes) {
    const nom = `Courrier_${d.nom}_${slug(k) || "PROPRIETAIRE-A-COMPLETER"}.docx`;
    const c = { id: d.id + ":" + nom, dossierId: d.id, nom, blob: await docxCourrier(d, g.o, g.parcelles), destinataire: k };
    await dbPut("courriers", c); out.push(c);
  }
  return out;
}
async function afficherCourriers(d) {
  const el = $("dCourriers"); if (!el) return;
  const l = (await dbAll("courriers")).filter(x => x.dossierId === d.id);
  el.innerHTML = l.length ? "" : `<p class="note">Créés à l'enregistrement.</p>`;
  l.forEach(c => {
    const b = document.createElement("button"); b.className = "btn btn2"; b.type = "button";
    b.textContent = "📄 " + (c.destinataire || "Propriétaire à compléter");
    b.onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(c.blob); a.download = c.nom; document.body.appendChild(a); a.click(); a.remove(); };
    el.appendChild(b);
  });
}

// ---- Identification differee (saisie sans reseau) -------------
async function resoudreEnAttente() {
  for (const d of dossiers) {
    let change = false;
    for (let i = 0; i < d.parcelles.length; i++) {
      const p = d.parcelles[i];
      try {
        if (p.etat !== "ok") {
          const r = await chercherParcelle(L.latLng(p.lat, p.lng));
          if (!r) continue;
          if (d.parcelles.some(x => x.idu === r.idu)) { d.parcelles.splice(i--, 1); change = true; continue; }
          d.parcelles[i] = r; await chargerZonage(r); await chargerProprietaire(r); change = true;
          if (d.nom.startsWith("A-IDENTIFIER")) { d.nom = slug(r.commune) + "-" + d.code; d.commune = r.commune; d.insee = r.insee; }
        } else if (p.proprioEtat === "attente" && d.auteurId === user.id) {
          await chargerProprietaire(p); change = change || p.proprioEtat !== "attente";
        }
      } catch (e) { /* toujours pas de reseau : nouvel essai plus tard */ }
    }
    if (change) {
      await dbPut("dossiers", d);
      if (d.enregistre) await enregistrerSilencieux(d);
      if (dossierCourant === d) afficherDossier();
    }
  }
}
async function enregistrerSilencieux(d) {
  const lettres = await genererCourriers(d);
  await dbPut("queue", { action: "save_dossier", data: pourServeur(d), dossierId: d.id });
  for (const l of lettres) await dbPut("queue", { action: "save_file", source: "courriers", ref: l.id, dossierId: d.id, dossierNom: d.nom });
}

// ---- Prospections sur la carte --------------------------------
function dessinerProspections() {
  if (!gProspections) return;
  gProspections.clearLayers();
  dossiers.forEach(d => {
    const coul = (STATUTS[d.statut] || STATUTS.PROSPECTE)[1];
    const initiales = String(d.auteur || "").split(/\s+/).map(x => x[0] || "").join("").toUpperCase();
    d.parcelles.forEach((p, i) => {
      const c = p.geom ? L.geoJSON(p.geom, { style: { color: coul, weight: 2, fillOpacity: .3 } }) : L.circleMarker([p.lat, p.lng], { radius: 8, color: coul, fillOpacity: .5 });
      c.on("click", e => {
        L.DomEvent.stopPropagation(e);
        if (peutEditer() && outil !== "info") { clicCarte(e.latlng); return; }
        dossierCourant = d; afficherDossier();
      });
      if (i === 0) c.bindTooltip(`${d.nom} · ${initiales}`, { permanent: false, direction: "top", className: "etiquette" });
      c.addTo(gProspections);
    });
  });
}

// ---- Panneaux -------------------------------------------------
function ouvrirSheet(titre, html, plein) {
  $("sheetTitre").textContent = titre;
  // Remplace le corps pour supprimer les anciens ecouteurs.
  const a = $("sheetCorps"), n = a.cloneNode(false); a.replaceWith(n); n.innerHTML = html;
  $("sheet").hidden = false; $("sheet").classList.toggle("plein", !!plein);
}
function fermerSheet() { $("sheet").hidden = true; }
$("sheetFermer").onclick = () => {
  fermerSheet(); parcelleInfo = null;
  if (dossierCourant) { dossierCourant = null; gSel.clearLayers(); enAjout = false; if (outil === "saisie") choisirOutil("info"); }
};
$("btnCouches").onclick = panneauCouches;
$("btnDossiers").onclick = () => {
  const l = [...dossiers].reverse();
  ouvrirSheet("Dossiers (" + l.length + ")", (l.length ? l.map(d => `<button class="dossier" data-d="${esc(d.id)}"><b>${esc(d.nom)}</b>${d.brouillon ? " · brouillon" : ""}<small>${d.parcelles.length} parcelle(s) · ${esc((STATUTS[d.statut] || ["—"])[0])} · ${esc(d.auteur)} · ${esc(d.cree)}</small></button>`).join("") : `<p class="note">Aucun dossier. Déverrouillez le cadenas puis touchez Saisie.</p>`));
  $("sheetCorps").querySelectorAll("[data-d]").forEach(b => b.onclick = () => {
    dossierCourant = dossiers.find(x => x.id === b.dataset.d);
    if (peutEditer()) { outil = "saisie"; document.querySelectorAll("[data-outil]").forEach(x => x.classList.toggle("on", x.dataset.outil === "saisie")); bandeau(null); }
    const p = dossierCourant.parcelles[0];
    if (p) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15));
    afficherDossier();
  });
};
$("btnCompte").onclick = async () => {
  const n = await nbAttente();
  ouvrirSheet(user.nom, `<div class="ligne"><span>Identifiant</span><span>${esc(user.id)}</span></div><div class="ligne"><span>En attente d'envoi</span><span>${n}</span></div><h3>Coordonnées reprises dans les courriers</h3><label for="cEmail">E-mail</label><input id="cEmail" type="email" value="${esc(user.email || "")}"><label for="cTel" style="margin-top:10px">Téléphone</label><input id="cTel" type="tel" value="${esc(user.tel || "")}"><button class="btn btn2" id="cProfil">Enregistrer mes coordonnées</button><h3>Application</h3><button class="btn btn2" id="cSync">🔄 Synchroniser</button>${user.sheetUrl ? `<a class="btn btn2" style="text-align:center;text-decoration:none" href="${esc(user.sheetUrl)}" target="_blank" rel="noopener">Ouvrir le Google Sheets</a>` : ""}<button class="btn danger" id="cDeco">Se déconnecter</button>`);
  $("cSync").onclick = async () => { await synchroniser(); toast("Synchronisation terminée"); };
  $("cDeco").onclick = deconnexion;
  $("cProfil").onclick = async () => {
    const email = $("cEmail").value.trim(), tel = $("cTel").value.trim();
    const r = await apiPost({ action: "update_profil", email, tel });
    if (!r || !r.success) { toast(r && r.error ? r.error : "Réseau nécessaire pour enregistrer", 1); return; }
    user.email = email; user.tel = tel; lss("pb5_user", user); toast("Coordonnées enregistrées");
  };
};

// ---- Lancement ------------------------------------------------
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(() => {});
(function () {
  const u = ls("pb5_user", null);
  if (u && u.token && apiUrl) { user = u; demarrer(); }
})();
