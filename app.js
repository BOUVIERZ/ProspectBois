// ================================================================
// PROSPECTBOIS v5 - application cartographique de prospection
// ================================================================
"use strict";
const CFG = window.PB_CONFIG;
const APICARTO = "https://apicarto.ign.fr/api";
const GEOPF = "https://data.geopf.fr";

// ---- Contenu de la saisie -------------------------------------
const THEMES = [
  { titre: "Nature et données du peuplement", bois: 1, champs: [
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
// Types de parcelles : couleur reprise dans l'appli, le Sheet et QGIS.
const TYPES = {
  BOIS: { l: "Bois", c: "#27ae60", dossier: "Bois" },
  PASSAGE: { l: "Droit de passage", c: "#2980b9", dossier: "Droit de passage" },
  MIXTE: { l: "Passage + bois", c: "#e67e22", dossier: "Droit de passage + bois" }
};
// Etapes du suivi ; pos : seulement apres une reponse positive.
const ETAPES = [
  { k: "courrier", l: "Courrier envoyé au propriétaire" },
  { k: "retour", l: "Réponse du propriétaire", choix: ["Positive", "Négative"] },
  { k: "om_envoye", l: "Ordre de mission envoyé", t: ["BOIS", "MIXTE"], pos: 1 },
  { k: "conv_envoyee", l: "Convention de passage envoyée", t: ["PASSAGE", "MIXTE"], pos: 1 },
  { k: "om_signe", l: "Ordre de mission signé reçu", t: ["BOIS", "MIXTE"], pos: 1 },
  { k: "conv_signee", l: "Convention de passage signée reçue", t: ["PASSAGE", "MIXTE"], pos: 1 },
  { k: "cubage", l: "Cubage réalisé", t: ["BOIS", "MIXTE"], pos: 1 },
  { k: "fiche_lot", l: "Fiche de lot envoyée au propriétaire", t: ["BOIS", "MIXTE"], pos: 1 }
];

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
  if (op.action === "archiver_dossier") {
    const f = op.ref && await dbGet("courriers", op.ref);
    return Object.assign({ action: op.action, id: op.id, resultat: op.resultat }, f ? { nom: f.nom, mime: f.blob.type || MIME_DOCX, base64: await b64(f.blob) } : {});
  }
  if (op.action !== "save_file" && op.action !== "envoyer_mail") return op;
  const src = await dbGet(op.source, op.ref);
  if (!src) return null;
  return { action: op.action, dossierId: op.dossierId, dossierNom: op.dossierNom, sousDossier: op.sousDossier || "", sujet: op.sujet || "", nom: src.nom, mime: src.blob.type || MIME_DOCX, base64: await b64(src.blob) };
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
      if (op.action === "archiver_dossier" && op.ref) await dbDel("courriers", op.ref);
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
  const supprimes = new Set(attente.filter(o => o.action === "delete_dossier" || o.action === "archiver_dossier").map(o => o.id));
  if (res.archivees) lss("pb5_archivees", res.archivees);
  const locaux = dossiers.filter(d => bloques.has(d.id) || d.brouillon);
  const fusion = res.dossiers.filter(d => !bloques.has(d.id) && !supprimes.has(d.id) && !locaux.find(l => l.id === d.id)).concat(locaux);
  for (const d of dossiers) if (!fusion.find(x => x.id === d.id)) await dbDel("dossiers", d.id);
  for (const d of fusion) await dbPut("dossiers", d);
  // Suivi pas encore envoye : rejoue sur la version du serveur.
  attente.filter(o => o.action === "save_suivi").forEach(o => {
    const d = fusion.find(x => x.id === o.dossierId), p = d && d.parcelles.find(x => x.idu === o.idu);
    if (p) p.suivi = fusionSuivi(p.suivi, o.suivi);
  });
  if (res.reglages) lss("pb5_reglages", res.reglages);
  dossiers = fusion;
  for (const d of fusion) await dbPut("dossiers", d);
  if (dossierCourant) { const d = fusion.find(x => x.id === dossierCourant.id); if (d && d !== dossierCourant && !document.activeElement.closest("#sheet")) { dossierCourant = d; afficherDossier(); } }
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
const typeDe = p => TYPES[p.type] ? p.type : "BOIS";
const aDuBois = d => d.parcelles.some(p => typeDe(p) !== "PASSAGE");
function nomDossier(d) {
  const base = (d.commune ? slug(d.commune) : "A-IDENTIFIER") + "-" + d.code, ld = slug(d.donnees.lieu_dit || "");
  return ld ? base + "-" + ld : base;
}
let typeCourant = ls("pb5_type", "BOIS");
function nouveauDossier(p) {
  const d = {
    id: uuid(), code: codeDossier(), nom: "", commune: p.etat === "ok" ? p.commune : "", insee: p.insee,
    auteur: user.nom, auteurId: user.id, cree: new Date().toLocaleDateString("fr-FR"), statut: "",
    donnees: { _contact: monContact() }, parcelles: [p], enregistre: false, brouillon: true, driveUrl: ""
  };
  d.nom = nomDossier(d);
  return d;
}
function preparerParcelle(p) { p.type = typeCourant; p.ajoute = isoJour(); return p; }
function htmlTypes() {
  return `<div class="types">${Object.keys(TYPES).map(k => `<button type="button" data-type="${k}" class="${k === typeCourant ? "on" : ""}" style="--c:${TYPES[k].c}">${esc(TYPES[k].l)}</button>`).join("")}</div>`;
}
// Bandeau de saisie : choix du type, puis toucher la parcelle.
function bandeauSaisie(texte, boutons) {
  bandeau(`${texte}${htmlTypes()}`, boutons);
  $("bandeau").querySelectorAll("[data-type]").forEach(b => b.onclick = () => {
    typeCourant = b.dataset.type; lss("pb5_type", typeCourant);
    $("bandeau").querySelectorAll("[data-type]").forEach(x => x.classList.toggle("on", x === b));
  });
}
const texteDebut = () => "Type de la parcelle, puis touchez-la sur la carte.";
async function demarrerSaisie() {
  if (parcelleInfo && !$("sheet").hidden) {
    const p = parcelleInfo; parcelleInfo = null;
    fermerSheet(); bandeauSaisie("Type de cette parcelle :", [["Créer le dossier", () => creerDossierAvec(preparerParcelle(p))]]);
  } else {
    fermerSheet(); gSel.clearLayers();
    bandeauSaisie(texteDebut());
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
  if (p.etat !== "ok") return true;
  const d = dossiers.find(x => x !== sauf && x.parcelles.some(y => y.idu === p.idu));
  if (d) return confirm(`Parcelle déjà prospectée par ${d.auteur} le ${d.cree} (dossier ${d.nom}). Continuer ?`);
  const a = ls("pb5_archivees", []).filter(x => x.idu === p.idu).pop();
  return !a || confirm(`Parcelle déjà prospectée par ${a.auteur} le ${frDate(versIso(a.date))} (dossier archivé ${a.dossier} : ${a.resultat}). Continuer ?`);
}
async function choixParcelleSaisie(ll) {
  if (dossierCourant && !enAjout) return;
  const reprendre = () => enAjout ? bandeauSaisie(ajoutTexte(), ajoutBoutons()) : bandeauSaisie(texteDebut());
  bandeau("Recherche de la parcelle…");
  const p = await identifierOuProvisoire(ll);
  if (!p) { reprendre(); return; }
  preparerParcelle(p);
  if (enAjout) await ajouterParcelle(p); else await creerDossierAvec(p);
}
async function creerDossierAvec(p) {
  if (!avertirDoublon(p)) { bandeauSaisie(texteDebut()); return; }
  const d = nouveauDossier(p);
  dossiers.push(d); dossierCourant = d; vueDossier = "saisie";
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
const ajoutTexte = () => `Ajout à <b>${esc(dossierCourant.nom)}</b> (${dossierCourant.parcelles.length}) : type, puis touchez la parcelle.`;
const ajoutBoutons = () => [["Terminer", finirAjout]];
function modeAjout() {
  enAjout = true; fermerSheet(); dessinerParcellesCourantes();
  bandeauSaisie(ajoutTexte(), ajoutBoutons());
}
function finirAjout() { enAjout = false; bandeau(null); afficherDossier(); }
function dessinerParcellesCourantes() {
  gSel.clearLayers();
  (dossierCourant ? dossierCourant.parcelles : []).forEach(p => {
    const c = TYPES[typeDe(p)].c;
    if (p.geom) L.geoJSON(p.geom, { style: { color: "#ffe14d", weight: 4, fillColor: c, fillOpacity: .35 }, interactive: false }).addTo(gSel);
    else L.circleMarker([p.lat, p.lng], { radius: 9, color: "#ffe14d", weight: 3, fillColor: c, fillOpacity: .6, interactive: false }).addTo(gSel);
  });
}
async function ajouterParcelle(p) {
  const d = dossierCourant;
  if (d.parcelles.some(x => x.idu === p.idu)) { toast("Déjà dans ce dossier"); bandeauSaisie(ajoutTexte(), ajoutBoutons()); return; }
  if (!avertirDoublon(p, d)) { bandeauSaisie(ajoutTexte(), ajoutBoutons()); return; }
  d.parcelles.push(p); d.brouillon = true;
  await dbPut("dossiers", d);
  dessinerParcellesCourantes(); bandeauSaisie(ajoutTexte(), ajoutBoutons());
  toast(p.etat === "ok" ? `${TYPES[p.type].l} : ${sansZero(p.section)} ${sansZero(p.numero)} ajoutée` : "Point ajouté");
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

// ---- Suivi des parcelles --------------------------------------
const isoJour = (x) => { const d = x || new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
function versIso(s) {
  s = String(s || "");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0") : "";
}
const frDate = iso => iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "";
const joursDepuis = iso => iso ? Math.floor((Date.now() - new Date(iso + "T12:00:00").getTime()) / 864e5) : 0;
const suiviDe = p => (p.suivi = p.suivi && p.suivi.f ? p.suivi : { f: {}, notes: [] });
const etapesDe = p => ETAPES.filter(e => !e.t || e.t.includes(typeDe(p)));
function datePros(p, d) { const f = suiviDe(p).f; return (f.prospection && f.prospection.v) || versIso(p.ajoute) || versIso(d.cree); }
// Etat lisible d'une parcelle : prochaine etape, avancement, relance.
function etatSuivi(p, d) {
  const f = suiviDe(p).f, et = etapesDe(p);
  const dates = [datePros(p, d)].concat(Object.keys(f).filter(k => k !== "prospection").map(k => f[k].v).filter(v => /^\d{4}-/.test(v || "")), suiviDe(p).notes.filter(n => !n.del).map(n => n.date));
  const derniere = dates.filter(Boolean).sort().pop() || "";
  const faites = et.filter(e => f[e.k] && f[e.k].v).length;
  let r;
  if (f.cloture && f.cloture.v) r = { lib: f.cloture.r || "Clôturé", fini: true, cls: "fin" };
  else if (f.retour && f.retour.v && f.retour.r === "Négative") r = { lib: "Refus du propriétaire", fini: true, cls: "refus" };
  else {
    const proch = et.find(e => !(f[e.k] && f[e.k].v));
    r = proch ? { lib: proch.l, fini: false, cls: "encours", prochaine: proch.k } : { lib: "Suivi terminé", fini: true, cls: "fin" };
  }
  r.faites = faites; r.total = et.length; r.derniere = derniere;
  r.relance = !r.fini && d.enregistre && joursDepuis(derniere) > delaiRappel();
  return r;
}
const delaiRappel = () => Number(ls("pb5_reglages", {}).delai_rappel_jours) || 30;
function fusionSuivi(a, b) {
  a = a && a.f ? a : { f: {}, notes: [] }; b = b && b.f ? b : { f: {}, notes: [] };
  const f = Object.assign({}, a.f);
  Object.keys(b.f).forEach(k => { if (!f[k] || (b.f[k].t || 0) >= (f[k].t || 0)) f[k] = b.f[k]; });
  const n = new Map(); (a.notes || []).concat(b.notes || []).forEach(x => { const o = n.get(x.id); if (!o || (x.t || 0) >= (o.t || 0)) n.set(x.id, x); });
  return { f, notes: [...n.values()].sort((x, y) => (x.t || 0) - (y.t || 0)) };
}
async function majSuivi(d, p, k, val) {
  suiviDe(p).f[k] = Object.assign({}, val, { t: Date.now(), par: user.nom });
  await dbPut("dossiers", d);
  await dbPut("queue", { action: "save_suivi", dossierId: d.id, idu: p.idu, suivi: p.suivi });
  majCarteParcelle(d, p);
  if (d.enregistre && !d.archive && d.parcelles.every(x => etatSuivi(x, d).fini)) await archiverDossier(d, resultatDossier(d), true);
  else vider();
}

// ---- Archives -------------------------------------------------
// Abouti si au moins une parcelle est allee au bout ; sinon non abouti (refus, abandon).
function resultatDossier(d) {
  return d.parcelles.some(p => { const f = suiviDe(p).f, e = etatSuivi(p, d); return (f.cloture && f.cloture.v && f.cloture.r === "Terminé") || (e.fini && e.lib === "Suivi terminé"); }) ? "Abouti" : "Non abouti";
}
async function archiverDossier(d, resultat, auto) {
  const fiche = await ficheDossier(d);
  await dbPut("courriers", fiche);
  await dbPut("queue", { action: "archiver_dossier", id: d.id, resultat, source: "courriers", ref: fiche.id, dossierId: d.id });
  dossiers = dossiers.filter(x => x.id !== d.id);
  await dbDel("dossiers", d.id);
  for (const x of await dbAll("photos")) if (x.dossierId === d.id) await dbDel("photos", x.id);
  for (const x of await dbAll("courriers")) if (x.dossierId === d.id && x.id !== fiche.id) await dbDel("courriers", x.id);
  dossierCourant = null; gSel.clearLayers(); fermerSheet(); dessinerProspections();
  const ok = await vider();
  toast((auto ? "Toutes les parcelles sont closes : dossier archivé (" : "Dossier archivé (") + resultat.toLowerCase() + ")" + (ok ? "" : ", envoi dès que possible"));
}
function choisirArchivage(d) {
  const r = resultatDossier(d), ouvertes = d.parcelles.filter(p => !etatSuivi(p, d).fini).length;
  ouvrirSheet("Archiver " + d.nom, `<p class="note">Le dossier quitte l'appli et part dans les archives : feuilles « Archives » du Google Sheets et dossier Drive « ProspectBois_Archives ». Il reste consultable et restaurable depuis Dossiers prospection > Archives.</p>${ouvertes ? `<div class="alerte">${ouvertes} parcelle(s) ont encore un suivi en cours.</div>` : ""}<label>Résultat du dossier</label><div class="boutons"><button class="btn" data-res="Abouti" type="button">Abouti</button><button class="btn btn2" data-res="Non abouti" type="button">Non abouti</button></div><p class="note">Proposé d'après le suivi : ${r}.</p><button class="btn btn2" id="aAnnuler" type="button">Annuler</button>`);
  $("sheetCorps").querySelectorAll("[data-res]").forEach(b => b.onclick = () => archiverDossier(d, b.dataset.res));
  $("aAnnuler").onclick = () => ouvrirDossier(d, "fiche");
}
async function listeArchives() {
  const el = $("dListe"); el.innerHTML = `<p class="note">Chargement des archives…</p>`;
  const r = await apiGet({ action: "get_archives" });
  if (!r || !r.archives) { el.innerHTML = `<p class="note">Archives consultables avec du réseau uniquement.</p>`; return; }
  const q = sansAccent(rechercheDossiers).trim().split(/\s+/).filter(Boolean);
  const l = r.archives.filter(a => { const t = sansAccent([a.nom, a.commune, a.auteur, a.proprietaires, a.lieu_dit, a.resultat].join(" ")); return q.every(m => t.includes(m)); });
  el.innerHTML = l.length ? l.map(a => `<button class="dossier" data-arch="${esc(a.id)}"><b>${esc(a.nom)}</b> <span class="${a.resultat === "Abouti" ? "abouti" : "nonabouti"}">${esc(a.resultat)}</span><small>${esc(a.auteur)} · ${esc(a.nb)} parcelle(s) · archivé le ${esc(frDate(a.archive_le))}</small></button>`).join("") : `<p class="note">Aucune archive${q.length ? " ne correspond" : ""}.</p>`;
  el.querySelectorAll("[data-arch]").forEach(b => b.onclick = async () => {
    b.disabled = true;
    const x = await apiGet({ action: "get_archive", id: b.dataset.arch });
    b.disabled = false;
    if (!x || !x.dossier) { toast("Archive inaccessible", 1); return; }
    dossierCourant = x.dossier; vueDossier = "fiche";
    const p = x.dossier.parcelles[0]; if (p && map) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15));
    afficherFiche(x.dossier);
  });
}
async function restaurer(d) {
  if (!confirm(`Remettre le dossier ${d.nom} dans l'appli ?`)) return;
  const r = await apiPost({ action: "restaurer_dossier", id: d.id });
  if (!r || !r.success) { toast(r && r.error ? r.error : "Réseau nécessaire", 1); return; }
  dossierCourant = null; fermerSheet(); await synchroniser(); toast("Dossier remis dans l'appli");
}

// ---- Affichage d'un dossier -----------------------------------
let vueDossier = "fiche";
function peutEditer() { return !document.body.classList.contains("locked"); }
function htmlChamp(c, d) {
  const v = d.donnees[c.k] || [], autre = d.donnees[c.k + "_autre"] || "";
  return `<div class="groupe"><label>${esc(c.l)}</label><div class="choix" data-champ="${c.k}" ${c.multi ? 'data-multi="1"' : ""}>${c.o.map(o => `<button type="button" class="${v.includes(o) ? "on" : ""}" data-v="${esc(o)}">${esc(o)}</button>`).join("")}</div>${c.autre ? `<input class="autre" data-autre="${c.k}" placeholder="Autre" aria-label="${esc(c.l)} : autre" value="${esc(autre)}">` : ""}</div>`;
}
function texteProprio(p) {
  if (p.etat !== "ok") return "au retour du réseau";
  if (p.proprietaires.length) return p.proprietaires.map(x => x.nom).join(", ");
  return ({ attente: "recherche…", non_trouve: "non trouvé", non_configure: "fichier non installé" })[p.proprioEtat] || "non trouvé";
}
const titreParcelle = p => p.etat === "ok" ? `${p.commune} · ${sansZero(p.section)} ${sansZero(p.numero)}` : `Point à identifier (${p.lat}, ${p.lng})`;
const chipType = k => `<span class="chip-type" style="--c:${TYPES[k].c}">${esc(TYPES[k].l)}</span>`;
function htmlParcelleSaisie(p, d) {
  const k = typeDe(p);
  return `<div class="parcelle" style="border-left:4px solid ${TYPES[k].c}"><div class="t"><b>${esc(titreParcelle(p))}</b><small>${p.contenance ? ha(p.contenance) : ""} · Propriétaire : ${esc(texteProprio(p))}</small><div class="types petit">${Object.keys(TYPES).map(t => `<button type="button" data-ptype="${esc(p.idu)}" data-v="${t}" class="${t === k ? "on" : ""}" style="--c:${TYPES[t].c}">${esc(TYPES[t].l)}</button>`).join("")}</div></div><button data-sup="${esc(p.idu)}" aria-label="Retirer la parcelle">🗑</button></div>`;
}
function htmlZoneDossier(d) {
  return d.parcelles.map(p => (d.parcelles.length > 1 ? `<p class="note"><b>${esc(sansZero(p.section))} ${esc(sansZero(p.numero))}</b></p>` : "") + htmlZonage(p)).join("");
}
function themesUtiles(d) { return THEMES.filter(t => !t.bois || aDuBois(d)); }
function afficherDossier() {
  const d = dossierCourant; if (!d) return;
  if (vueDossier === "saisie" && peutEditer()) afficherSaisie(d); else afficherFiche(d);
}
function ouvrirDossier(d, vue) {
  dossierCourant = d; vueDossier = vue || (d.brouillon && peutEditer() ? "saisie" : "fiche");
  const p = d.parcelles[0];
  if (p && map) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15));
  afficherDossier();
}

function afficherSaisie(d) {
  const P = d.parcelles[0];
  let h = "";
  if (d.auteurId !== user.id) h += `<div class="alerte">Dossier de ${esc(d.auteur)}.</div>`;
  h += `<h3>Parcelles (${d.parcelles.length})</h3><div id="dParcelles">${d.parcelles.map(p => htmlParcelleSaisie(p, d)).join("")}</div>`;
  h += `<button class="plus" id="dPlus">+ Ajouter une parcelle</button>`;
  h += `<h3>Dossier</h3><div class="ligne"><span>N° de prospection</span><span>${esc(d.code)}</span></div>${htmlCadastre(P)}`;
  h += `<div class="groupe" style="margin-top:10px"><label for="dLieuDit">Lieu-dit (ajouté au nom du dossier et repris dans le courrier)</label><input id="dLieuDit" value="${esc(d.donnees.lieu_dit || "")}"></div>`;
  themesUtiles(d).forEach(t => {
    h += `<h3>${esc(t.titre)}</h3>` + t.champs.map(c => htmlChamp(c, d)).join("");
    if (t.photos) h += `<button class="btn btn2" id="dPhoto" type="button">📷 Prendre des photos</button><div class="photos" id="dPhotos"></div>`;
  });
  if (!aDuBois(d)) h += `<p class="note">Dossier de droit de passage uniquement : la partie peuplement n'est pas demandée.</p><div class="photos" id="dPhotos"></div><button class="btn btn2" id="dPhoto" type="button">📷 Prendre des photos</button>`;
  h += `<h3>Zonage réglementaire</h3><div id="dZonage">${htmlZoneDossier(d)}</div>`;
  h += `<h3>Réglementation communale</h3>`;
  REGLES.forEach(r => {
    const v = d.donnees[r.k] || "";
    h += `<div class="groupe"><label>${esc(r.l)}</label><div class="choix" data-regle="${r.k}"><button type="button" class="${v === "OUI" ? "on" : ""}" data-v="OUI">Oui</button><button type="button" class="${v === "NON" ? "on" : ""}" data-v="NON">Non</button></div><input class="autre" data-detail="${r.k}" placeholder="${esc(r.q)}" aria-label="${esc(r.l)} : ${esc(r.q)}" value="${esc(d.donnees[r.k + "_detail"] || "")}" ${v === "OUI" ? "" : "hidden"}></div>`;
  });
  h += `<div class="groupe"><label for="dRegAutre">Autre</label><input id="dRegAutre" value="${esc(d.donnees.regle_autre || "")}"></div>`;
  h += `<button class="btn" id="dSave">💾 Enregistrer</button>`;
  if (d.enregistre) h += `<button class="btn btn2" id="dVoirFiche">Voir la fiche et le suivi</button>`;
  h += `<button class="btn danger" id="dSup">Supprimer le dossier</button>`;
  ouvrirSheet(d.nom, h, true);
  brancherSaisie(d);
  dessinerParcellesCourantes();
  afficherPhotos(d, true);
}
function rafraichirDossierPartiel() {
  const d = dossierCourant; if (!d) return;
  const el = $("dZonage"), pl = $("dParcelles");
  if (el) el.innerHTML = htmlZoneDossier(d);
  if (pl && vueDossier === "saisie") pl.innerHTML = d.parcelles.map(p => htmlParcelleSaisie(p, d)).join("");
}
function brancherSaisie(d) {
  const c = $("sheetCorps");
  const maj = () => { d.brouillon = true; dbPut("dossiers", d); };
  $("dPlus").onclick = modeAjout;
  $("dSup").onclick = supprimerDossier;
  $("dSave").onclick = () => enregistrerDossier(d);
  if ($("dVoirFiche")) $("dVoirFiche").onclick = () => { vueDossier = "fiche"; afficherDossier(); };
  c.querySelectorAll("#dPhoto").forEach(b => b.onclick = () => $("fichierPhoto").click());
  c.addEventListener("click", e => {
    const s = e.target.closest("[data-sup]"); if (s) { supprimerParcelle(s.dataset.sup); return; }
    const pt = e.target.closest("[data-ptype]");
    if (pt) {
      const p = d.parcelles.find(x => x.idu === pt.dataset.ptype), avant = aDuBois(d);
      p.type = pt.dataset.v; maj(); dessinerParcellesCourantes();
      if (avant !== aDuBois(d)) afficherSaisie(d); else rafraichirDossierPartiel();
      return;
    }
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
    else if (t.id === "dLieuDit") { d.donnees.lieu_dit = t.value; d.nom = nomDossier(d); $("sheetTitre").textContent = d.nom; }
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
function comptesTypes(d) { const n = {}; d.parcelles.forEach(p => { const k = typeDe(p); n[k] = (n[k] || 0) + 1; }); return n; }
function proprietairesDe(d) { return [...new Set(d.parcelles.flatMap(p => p.proprietaires.map(x => x.nom)))]; }
function zonagesDe(d) { const s = new Map(); d.parcelles.forEach(p => (p.zonage || []).forEach(z => s.set(z.type + "|" + z.nom, z))); return [...s.values()]; }

// Fiche lisible du dossier, puis suivi de chaque parcelle.
function afficherFiche(d) {
  const ligne = (a, b) => b ? `<div class="ligne"><span>${esc(a)}</span><span>${esc(b)}</span></div>` : "";
  const n = comptesTypes(d), surf = d.parcelles.reduce((s, p) => s + (p.contenance || 0), 0);
  let h = "";
  const arch = d.archive;
  if (arch) h += `<div class="alerte">Dossier archivé le ${esc(frDate(arch.le))} par ${esc(arch.par)} : <b>${esc(arch.resultat)}</b>. Consultation seule.</div>`;
  if (d.brouillon) h += `<div class="alerte">Brouillon non enregistré${peutEditer() ? "" : " : déverrouillez le cadenas pour le terminer"}.</div>`;
  h += `<div class="chips">${Object.keys(n).map(k => chipType(k) + `<b class="nb">${n[k]}</b>`).join("")}</div>`;
  h += ligne("N° de prospection", d.code) + ligne("Commune", [...new Set(d.parcelles.map(p => p.commune).filter(Boolean))].join(", ")) + ligne("Lieu-dit", d.donnees.lieu_dit) +
    ligne("Gestionnaire", d.auteur) + ligne("Créé le", d.cree) + ligne("Parcelles", d.parcelles.length + " · " + ha(surf)) + ligne("Propriétaires", proprietairesDe(d).join(", ") || "—");
  h += `<div class="boutons"><button class="btn btn2" id="fWord" type="button">📄 Fiche récap (Word)</button><button class="btn btn2" id="fMail" type="button">✉️ Recevoir la fiche</button></div>`;
  if (arch) h += `<button class="btn btn2" id="fRestaurer" type="button">↩️ Remettre dans l'appli</button>`;
  else h += peutEditer() ? `<button class="btn btn2" id="fModif" type="button">✏️ Modifier la saisie</button>` : `<p class="note">Déverrouillez le cadenas pour modifier la saisie. Le suivi se renseigne à tout moment.</p>`;
  if (d.driveUrl) h += `<a class="btn btn2" style="text-align:center;text-decoration:none" href="${esc(d.driveUrl)}" target="_blank" rel="noopener">📁 Ouvrir le dossier dans Drive</a>`;
  themesUtiles(d).forEach(t => {
    const l = t.champs.map(c => ligne(c.l, valeurLisible(d, c.k))).join("");
    h += `<h3>${esc(t.titre)}</h3>${l || `<p class="note">Rien de saisi.</p>`}`;
    if (t.photos) h += `<div class="photos" id="dPhotos"></div>`;
  });
  h += `<h3>Réglementation communale</h3>` + (reglesLisibles(d).map(x => ligne(x[0], x[1])).join("") || `<p class="note">Rien de saisi.</p>`);
  h += `<h3>Zonage réglementaire</h3><div id="dZonage">${htmlZoneDossier(d)}</div>`;
  h += `<h3>Suivi des parcelles</h3>`;
  if (!d.enregistre) h += `<p class="note">Le suivi démarre une fois le dossier enregistré.</p>`;
  Object.keys(TYPES).forEach(k => {
    const ps = d.parcelles.filter(p => typeDe(p) === k);
    if (!ps.length) return;
    h += `<div class="sous-dossier" style="--c:${TYPES[k].c}"><div class="sd-tete">📁 ${esc(TYPES[k].dossier)} (${ps.length})</div>${ps.map(p => htmlCarteSuivi(p, d)).join("")}</div>`;
  });
  if (d.enregistre && !arch) h += `<h3>Archiver</h3><p class="note">Le dossier est archivé automatiquement quand toutes ses parcelles sont closes. Vous pouvez aussi l'archiver vous-même.</p><button class="btn btn2" id="fArchiver" type="button">🗄 Archiver ce dossier</button>`;
  ouvrirSheet(d.nom, h, true);
  brancherFiche(d);
  dessinerParcellesCourantes();
  afficherPhotos(d, false);
}
function htmlEnteteSuivi(p, d) {
  const e = etatSuivi(p, d), pc = e.total ? Math.round(e.faites / e.total * 100) : 0;
  return `<div class="t"><b>${esc(titreParcelle(p))}</b><small>${p.contenance ? ha(p.contenance) + " · " : ""}${esc(texteProprio(p))}</small></div>
    <div class="etat ${e.cls}">${e.fini ? "" : "Prochaine étape : "}<b>${esc(e.lib)}</b>${e.relance ? `<span class="relance">À relancer · ${joursDepuis(e.derniere)} j</span>` : ""}</div>
    <div class="prog"><i style="width:${pc}%"></i></div><small class="note">${e.faites}/${e.total} étapes · dernière action ${frDate(e.derniere) || "—"}</small>`;
}
function htmlCarteSuivi(p, d) {
  const id = esc(p.idu);
  return `<div class="carte-suivi" data-carte="${id}"><div class="entete" id="ent-${id}">${htmlEnteteSuivi(p, d)}</div>
    <div class="boutons"><button type="button" class="btn2 mini" data-ouvrir="${id}">Suivi ▾</button>${d.archive ? "" : `<button type="button" class="btn2 mini" data-mail="${id}">✉️ Courrier par e-mail</button><button type="button" class="btn2 mini" data-dl="${id}">📄 Courrier</button>`}</div>
    <div class="detail" id="det-${id}" hidden></div></div>`;
}
function htmlDetailSuivi(p, d) {
  const s = suiviDe(p), f = s.f, ok = d.enregistre && !d.archive, dis = ok ? "" : "disabled";
  const pos = f.retour && f.retour.v && f.retour.r === "Positive";
  let h = `<div class="groupe"><label>Date de prospection</label><input type="date" data-sv="prospection" value="${esc(datePros(p, d))}" ${dis}></div>`;
  h += `<div class="groupe"><label>Contact du propriétaire</label><input type="email" data-sv="email_proprio" placeholder="E-mail" value="${esc((f.email_proprio || {}).v || "")}" ${dis}><input class="autre" type="tel" data-sv="tel_proprio" placeholder="Téléphone" value="${esc((f.tel_proprio || {}).v || "")}" ${dis}>`;
  const em = (f.email_proprio || {}).v, te = (f.tel_proprio || {}).v;
  if (em || te) h += `<div class="liens">${em ? `<a href="mailto:${esc(em)}">✉️ Écrire</a>` : ""}${te ? `<a href="tel:${esc(String(te).replace(/\s/g, ""))}">📞 Appeler</a>` : ""}</div>`;
  h += `</div><div class="etapes">`;
  etapesDe(p).forEach(e => {
    const v = f[e.k] || {}, fait = !!v.v, bloque = e.pos && !pos;
    h += `<div class="etape ${fait ? "fait" : ""} ${bloque ? "bloque" : ""}"><span class="ico">${fait ? "✓" : ""}</span><div class="lib">${esc(e.l)}${bloque ? `<small>Après une réponse positive</small>` : ""}${fait && v.par ? `<small>par ${esc(v.par)}</small>` : ""}</div>`;
    if (e.choix) h += `<div class="choix petit">${e.choix.map(c => `<button type="button" data-rep="${esc(e.k)}" data-v="${esc(c)}" class="${v.r === c ? "on" : ""}" ${dis}>${esc(c)}</button>`).join("")}</div>`;
    h += `<input type="date" data-sv="${esc(e.k)}" value="${esc(v.v || "")}" aria-label="${esc(e.l)} : date" ${dis || (bloque ? "disabled" : "")}>`;
    if (!fait && !bloque && !e.choix) h += `<button type="button" class="mini" data-auj="${esc(e.k)}" ${dis}>Aujourd'hui</button>`;
    h += `</div>`;
  });
  const cl = f.cloture || {};
  h += `</div><div class="groupe"><label>Clôturer le suivi</label><div class="choix petit">${["Terminé", "Abandonné"].map(c => `<button type="button" data-clot="${c}" class="${cl.v && cl.r === c ? "on" : ""}" ${dis}>${c}</button>`).join("")}</div></div>`;
  h += `<div class="groupe"><label>Notes</label>${s.notes.filter(n => !n.del).map(n => `<div class="note-suivi"><small>${frDate(n.date)} · ${esc(n.par || "")}</small>${esc(n.txt)}</div>`).join("") || `<p class="note">Aucune note.</p>`}<textarea rows="2" data-note placeholder="Appel, échange, remarque…" ${dis}></textarea><button type="button" class="btn btn2" data-ajnote ${dis}>Ajouter la note</button></div>`;
  return h;
}
function majCarteParcelle(d, p) {
  const e = document.getElementById("ent-" + p.idu); if (e) e.innerHTML = htmlEnteteSuivi(p, d);
  const det = document.getElementById("det-" + p.idu); if (det && !det.hidden) det.innerHTML = htmlDetailSuivi(p, d);
}
function brancherFiche(d) {
  const c = $("sheetCorps"), parc = idu => d.parcelles.find(x => x.idu === idu);
  $("fWord").onclick = async () => telecharger(await ficheDossier(d));
  $("fMail").onclick = async () => envoyerParMail(await ficheDossier(d), `Fiche récapitulative ${d.nom}`);
  if ($("fRestaurer")) $("fRestaurer").onclick = () => restaurer(d);
  if ($("fArchiver")) $("fArchiver").onclick = () => choisirArchivage(d);
  if ($("fModif")) $("fModif").onclick = () => { vueDossier = "saisie"; outil = "saisie"; document.querySelectorAll("[data-outil]").forEach(x => x.classList.toggle("on", x.dataset.outil === "saisie")); bandeau(null); afficherDossier(); };
  c.addEventListener("click", async e => {
    const t = e.target;
    const o = t.closest("[data-ouvrir]");
    if (o) { const det = document.getElementById("det-" + o.dataset.ouvrir); det.hidden = !det.hidden; if (!det.hidden) det.innerHTML = htmlDetailSuivi(parc(o.dataset.ouvrir), d); o.textContent = det.hidden ? "Suivi ▾" : "Suivi ▴"; return; }
    const m = t.closest("[data-mail]"); if (m) { const l = await courrierDe(d, parc(m.dataset.mail)); if (l) envoyerParMail(l, `Courrier ${d.nom} : ${l.destinataire || "propriétaire à compléter"}`); return; }
    const dl = t.closest("[data-dl]"); if (dl) { const l = await courrierDe(d, parc(dl.dataset.dl)); if (l) telecharger(l); return; }
    const carte = t.closest("[data-carte]"); if (!carte || d.archive) return;
    const p = parc(carte.dataset.carte);
    if (t.dataset.auj) { await majSuivi(d, p, t.dataset.auj, { v: isoJour() }); return; }
    if (t.dataset.rep) { const cur = suiviDe(p).f[t.dataset.rep] || {}; await majSuivi(d, p, t.dataset.rep, { v: cur.v || isoJour(), r: t.dataset.v }); return; }
    if (t.dataset.clot) { const cur = suiviDe(p).f.cloture || {}; const off = cur.v && cur.r === t.dataset.clot; await majSuivi(d, p, "cloture", off ? { v: "" } : { v: isoJour(), r: t.dataset.clot }); return; }
    if (t.dataset.ajnote !== undefined) {
      const ta = carte.querySelector("[data-note]"), txt = ta.value.trim(); if (!txt) return;
      suiviDe(p).notes.push({ id: uuid(), txt, date: isoJour(), par: user.nom, t: Date.now() });
      await dbPut("dossiers", d); enfiler({ action: "save_suivi", dossierId: d.id, idu: p.idu, suivi: p.suivi });
      majCarteParcelle(d, p); toast("Note ajoutée");
    }
  });
  c.addEventListener("change", async e => {
    const t = e.target, carte = t.closest("[data-carte]"); if (!carte || !t.dataset.sv || d.archive) return;
    const p = parc(carte.dataset.carte), k = t.dataset.sv, cur = suiviDe(p).f[k] || {};
    await majSuivi(d, p, k, Object.assign({}, cur, { v: t.value }));
  });
}
function telecharger(doc) { const a = document.createElement("a"); a.href = URL.createObjectURL(doc.blob); a.download = doc.nom; document.body.appendChild(a); a.click(); a.remove(); }
async function envoyerParMail(doc, sujet) {
  if (!user.email) { toast("Renseignez votre e-mail dans Compte 👤", 1); return; }
  await dbPut("courriers", doc);
  const ok = await enfiler({ action: "envoyer_mail", source: "courriers", ref: doc.id, sujet, dossierId: doc.dossierId });
  toast(ok ? "Envoyé sur " + user.email : "Sera envoyé sur " + user.email + " au retour du réseau");
}

// ---- Photos ---------------------------------------------------
$("fichierPhoto").onchange = async e => {
  const fichiers = [...e.target.files]; e.target.value = "";
  const d = dossierCourant; if (!d) return;
  for (const f of fichiers) {
    try {
      const blob = await reduirePhoto(f), n = (await dbAll("photos")).filter(x => x.dossierId === d.id).length + 1;
      const id = uuid();
      await dbPut("photos", { id, dossierId: d.id, nom: `${d.code}_photo_${String(n).padStart(2, "0")}_${id.slice(0, 4)}.jpg`, blob, envoye: false });
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
        if (x.envoye) enfiler({ action: "delete_file", dossierId: d.id, dossierNom: d.nom, nom: x.nom, sousDossier: "Photos" });
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
// Courriers par type et par proprietaire, et fiche, envoyes dans Drive.
async function fileDocuments(d) {
  const lettres = await genererCourriers(d), fiche = await ficheDossier(d);
  await dbPut("courriers", fiche);
  await dbPut("queue", { action: "save_dossier", data: pourServeur(d), dossierId: d.id });
  await dbPut("queue", { action: "vider_courriers", dossierId: d.id, dossierNom: d.nom });
  for (const l of lettres) await dbPut("queue", { action: "save_file", source: "courriers", ref: l.id, dossierId: d.id, dossierNom: d.nom, sousDossier: TYPES[l.type].dossier });
  await dbPut("queue", { action: "save_file", source: "courriers", ref: fiche.id, dossierId: d.id, dossierNom: d.nom });
}
async function enregistrerDossier(d) {
  d.nom = nomDossier(d);
  d.brouillon = false; d.enregistre = true; d.modifie = new Date().toISOString();
  if (d.auteurId === user.id) d.donnees._contact = monContact();
  await dbPut("dossiers", d);
  await fileDocuments(d);
  for (const x of await dbAll("photos")) if (x.dossierId === d.id && !x.envoye) {
    await dbPut("queue", { action: "save_file", source: "photos", ref: x.id, dossierId: d.id, dossierNom: d.nom, sousDossier: "Photos" });
    x.envoye = true; await dbPut("photos", x);
  }
  dessinerProspections();
  enAjout = false; vueDossier = "fiche"; afficherDossier();
  const ok = await vider();
  toast(ok ? "Dossier enregistré et envoyé" : "Dossier enregistré, envoi dès que possible");
}

// ---- Documents Word -------------------------------------------
const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
function runsDe(p) { return [...p.childNodes].filter(n => n.namespaceURI === NS_W && n.localName === "r"); }
function texteRun(r, t) { const x = r.getElementsByTagNameNS(NS_W, "t")[0]; x.textContent = t; x.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve"); }
function retirer(r, nom) { [...r.getElementsByTagNameNS(NS_W, nom)].forEach(n => n.remove()); }
// Une valeur absente garde le texte du modele, surligne pour ne pas partir ainsi.
function remplir(r, valeur, attente) {
  if (valeur) { texteRun(r, valeur); retirer(r, "i"); retirer(r, "iCs"); return; }
  texteRun(r, attente);
  surlignerRun(r);
}
function surlignerRun(r) {
  let pr = r.getElementsByTagNameNS(NS_W, "rPr")[0];
  if (!pr) { pr = r.ownerDocument.createElementNS(NS_W, "w:rPr"); r.insertBefore(pr, r.firstChild); }
  const h = r.ownerDocument.createElementNS(NS_W, "w:highlight"); h.setAttributeNS(NS_W, "w:val", "yellow"); pr.appendChild(h);
}
function liste(l) { return l.length < 2 ? (l[0] || "") : l.slice(0, -1).join(", ") + " et " + l[l.length - 1]; }
const sansZero = v => String(v || "").replace(/^0+(?=.)/, "");
const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const modeles = {};
async function chargerModele(f) {
  if (!modeles[f]) { const r = await fetch(f); if (!r.ok) throw new Error("modele " + f); modeles[f] = await r.arrayBuffer(); }
  return modeles[f];
}
async function ouvrirDocx(f) {
  const z = await JSZip.loadAsync(await chargerModele(f));
  const xml = new DOMParser().parseFromString(await z.file("word/document.xml").async("string"), "application/xml");
  return { z, xml };
}
async function fermerDocx(z, xml) {
  z.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + new XMLSerializer().serializeToString(xml.documentElement));
  return z.generateAsync({ type: "blob", mimeType: MIME_DOCX, compression: "DEFLATE" });
}
function numerosParcelles(parcelles) {
  const parSection = new Map();
  parcelles.forEach(p => { const s = sansZero(p.section); if (!parSection.has(s)) parSection.set(s, []); parSection.get(s).push(sansZero(p.numero)); });
  const g = [...parSection.entries()], dernier = g[g.length - 1];
  return { debut: g.slice(0, -1).map(([s, n]) => liste(n) + " de la section " + s).concat(liste(dernier[1])).join(" et "), section: dernier[0], complet: g.map(([s, n]) => liste(n) + " de la section " + s).join(" et ") };
}
// Entete commun : destinataire, date, coordonnees et signature du gestionnaire.
function remplirEntete(xml, d, proprio) {
  const ps = [...xml.getElementsByTagNameNS(NS_W, "p")];
  const trouve = debut => { const p = ps.find(x => x.textContent.trim().startsWith(debut)); if (!p) throw new Error("Modèle de courrier modifié : " + debut); return runsDe(p); };
  const contact = (d.donnees && d.donnees._contact) || {};
  remplir(trouve("Prénom et NOM")[0], proprio && proprio.nom, "Prénom et NOM");
  remplir(trouve("Adresse")[0], proprio && proprio.adresse, "Adresse");
  remplir(trouve("Code postale")[0], proprio && [proprio.cp, proprio.ville].filter(Boolean).join(" "), "Code postal et ville");
  const fait = trouve("Fait à");
  texteRun(fait[1], new Date().toLocaleDateString("fr-FR")); fait.slice(2).forEach(r => texteRun(r, ""));
  remplir(trouve("E-mail")[1], contact.email, "[e-mail du gestionnaire]");
  remplir(trouve("Téléphone")[1], contact.tel, "[téléphone du gestionnaire]");
  remplir(trouve("[Nom du gestionnaire]")[0], contact.nom, "[Nom du gestionnaire]");
  return trouve;
}
async function courrierBois(d, proprio, parcelles) {
  const { z, xml } = await ouvrirDocx("modele_courrier.docx");
  const trouve = remplirEntete(xml, d, proprio);
  const commune = liste([...new Set(parcelles.map(p => p.commune).filter(Boolean))]);
  remplir(trouve("Gestionnaire forestier au sein")[1], commune, "[commune]");
  const n = numerosParcelles(parcelles), plusieurs = parcelles.length > 1;
  const r = trouve("Notre société accompagne");
  if (plusieurs) { texteRun(r[1], "s"); texteRun(r[2], " parcelles"); }
  remplir(r[4], n.debut, "[parcelle]");
  remplir(r[8], n.section, "[section]");
  texteRun(r[9], " ");
  remplir(r[12], d.donnees.lieu_dit, "[lieu-dit]");
  remplir(r[15], commune ? " " + commune : "", " [commune]");
  const fin = r[16].getElementsByTagNameNS(NS_W, "t")[0];
  fin.textContent = fin.textContent.replace("situées", plusieurs ? "situées" : "située");
  return fermerDocx(z, xml);
}
// Remplace le texte d'un paragraphe par des segments [texte, gras, manquant].
function reecrire(p, segments) {
  const rs = runsDe(p), modele = rs[0];
  rs.slice(1).forEach(r => r.remove());
  segments.forEach((s, i) => {
    const r = i === 0 ? modele : modele.cloneNode(true);
    if (i > 0) p.appendChild(r);
    retirer(r, "b"); retirer(r, "bCs"); retirer(r, "highlight");
    texteRun(r, s[0]);
    if (s[1]) { let pr = r.getElementsByTagNameNS(NS_W, "rPr")[0]; if (!pr) { pr = r.ownerDocument.createElementNS(NS_W, "w:rPr"); r.insertBefore(pr, r.firstChild); } pr.insertBefore(r.ownerDocument.createElementNS(NS_W, "w:b"), pr.firstChild); }
    if (s[2]) surlignerRun(r);
  });
}
// Courriers droit de passage et passage + bois : modeles de la societe.
async function courrierPassage(d, proprio, parcelles, avecBois) {
  const { z, xml } = await ouvrirDocx(avecBois ? "modele_passage_bois.docx" : "modele_passage.docx");
  const ps = [...xml.getElementsByTagNameNS(NS_W, "p")];
  const para = debut => { const p = ps.find(x => x.textContent.trim().startsWith(debut)); if (!p) throw new Error("Modèle de courrier modifié : " + debut); return p; };
  const runs = debut => runsDe(para(debut));
  const contact = (d.donnees && d.donnees._contact) || {};
  const commune = liste([...new Set(parcelles.map(p => p.commune).filter(Boolean))]);
  const n = numerosParcelles(parcelles), pl = parcelles.length > 1;
  remplir(runs("Prénom NOM")[0], proprio && proprio.nom, "Prénom et NOM");
  remplir(runs("ADRESSE")[0], proprio && proprio.adresse, "Adresse");
  remplir(runs("CODE POSTALE")[0], proprio && [proprio.cp, proprio.ville].filter(Boolean).join(" "), "Code postal et ville");
  texteRun(runs("Fait à")[1], new Date().toLocaleDateString("fr-FR"));
  const r1 = runs("Gestionnaire forestier au sein");
  if (pl) { texteRun(r1[1], "s"); texteRun(r1[2], " parcelles"); }
  remplir(r1[4], n.complet, "[parcelle]");
  remplir(r1[8], commune, "[commune]");
  const r2 = runs("Notre société intervient");
  if (pl) {
    // Reperes par le texte, pas par la position : resiste aux retouches du modele.
    const i = r2.findIndex(r => /^v[oô]tre$/.test(r.textContent)), j = r2.findIndex(r => /traverse vo$/.test(r.textContent));
    if (i > 0) { texteRun(r2[i - 1], r2[i - 1].textContent.replace(/à la $/, "aux ")); texteRun(r2[i], "vôtres"); }
    if (j >= 0 && r2[j + 2]) { texteRun(r2[j + 1], "s"); texteRun(r2[j + 2], r2[j + 2].textContent.replace(" parcelle.", " parcelles.")); }
    if (avecBois) runs("Cette intervention pourrait").forEach(r => { const t = r.getElementsByTagNameNS(NS_W, "t")[0]; if (t) t.textContent = t.textContent.replace("sur votre parcelle", "sur vos parcelles"); });
  }
  const lien = (debut, lib, val, attente) => reecrire(para(debut), val ? [[lib], [val, 1]] : [[lib], [attente, 1, 1]]);
  lien("[Mail", "E-mail : ", contact.email, "[e-mail du gestionnaire]");
  lien("[Téléphone", "Téléphone : ", contact.tel, "[téléphone du gestionnaire]");
  remplir(runs("[nom du gestionnaire]")[0], contact.nom, "[Nom du gestionnaire]");
  return fermerDocx(z, xml);
}
async function docxCourrier(d, proprio, parcelles, type) {
  if (type === "PASSAGE") return courrierPassage(d, proprio, parcelles, false);
  if (type === "MIXTE") return courrierPassage(d, proprio, parcelles, true);
  return courrierBois(d, proprio, parcelles);
}
// Un courrier par type de parcelle et par proprietaire, avec toutes ses parcelles.
async function genererCourriers(d) {
  const groupes = new Map();
  d.parcelles.filter(p => p.etat === "ok").forEach(p => {
    const ps = p.proprietaires.length ? p.proprietaires : [null], t = typeDe(p);
    ps.forEach(o => { const k = t + "|" + (o ? o.nom : ""); if (!groupes.has(k)) groupes.set(k, { o, t, parcelles: [] }); groupes.get(k).parcelles.push(p); });
  });
  for (const x of await dbAll("courriers")) if (x.dossierId === d.id && x.kind === "courrier") await dbDel("courriers", x.id);
  const out = [];
  for (const g of groupes.values()) {
    const qui = g.o ? g.o.nom : "";
    const nom = `Courrier_${slug(TYPES[g.t].l)}_${d.code}_${slug(qui) || "PROPRIETAIRE-A-COMPLETER"}${qui ? "" : "_" + sansZero(g.parcelles[0].section) + sansZero(g.parcelles[0].numero)}.docx`;
    const c = { id: d.id + ":" + nom, kind: "courrier", dossierId: d.id, nom, type: g.t, idus: g.parcelles.map(p => p.idu), blob: await docxCourrier(d, g.o, g.parcelles, g.t), destinataire: qui };
    await dbPut("courriers", c); out.push(c);
  }
  return out;
}
async function courrierDe(d, p) {
  if (p.etat !== "ok") { toast("Parcelle pas encore identifiée", 1); return null; }
  let l = (await dbAll("courriers")).find(x => x.dossierId === d.id && x.kind === "courrier" && (x.idus || []).includes(p.idu) && x.type === typeDe(p));
  if (!l) { await genererCourriers(d); l = (await dbAll("courriers")).find(x => x.dossierId === d.id && x.kind === "courrier" && (x.idus || []).includes(p.idu)); }
  return l || null;
}

// Fiche recapitulative : contenu genere dans le modele (logo et pied de page).
function wRun(t, o) { o = o || {}; return `<w:r><w:rPr>${o.b ? "<w:b/>" : ""}${o.c ? `<w:color w:val="${o.c}"/>` : ""}${o.sz ? `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` : ""}</w:rPr><w:t xml:space="preserve">${xe(t)}</w:t></w:r>`; }
function wPar(runs, o) { o = o || {}; return `<w:p><w:pPr>${o.keep ? "<w:keepNext/>" : ""}<w:spacing w:before="${o.avant || 0}" w:after="${o.apres === undefined ? 80 : o.apres}"/>${o.centre ? '<w:jc w:val="center"/>' : ""}</w:pPr>${runs}</w:p>`; }
function xe(s) { return String(s === undefined || s === null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function wCell(t, w, o) { o = o || {}; return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.fond ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fond}"/>` : ""}</w:tcPr>${String(t).split("\n").map(l => wPar(wRun(l, { b: o.b, sz: 18 }), { apres: 0 })).join("")}</w:tc>`; }
function wTable(lignes, largeurs, entete) {
  const bord = ["top", "left", "bottom", "right", "insideH", "insideV"].map(b => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="B7C4AE"/>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${largeurs.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${bord}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${largeurs.map(w => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>` +
    lignes.map((l, i) => `<w:tr>${i === 0 && entete ? '<w:trPr><w:tblHeader/></w:trPr>' : ""}${l.map((t, j) => wCell(t, largeurs[j], i === 0 && entete ? { b: 1, fond: "E3EBDD" } : (!entete && j === 0 ? { fond: "F2F5EF" } : {}))).join("")}</w:tr>`).join("") + `</w:tbl>`;
}
const wTitre = t => wPar(wRun(t, { b: 1, sz: 24, c: "2F5A28" }), { avant: 200, apres: 80, keep: 1 });
async function ficheDossier(d) {
  const { z } = await ouvrirDocx("modele_courrier.docx");
  let doc = await z.file("word/document.xml").async("string");
  const n = comptesTypes(d), surf = d.parcelles.reduce((s, p) => s + (p.contenance || 0), 0), L2 = [2700, 6372];
  let b = wPar(wRun("Fiche récapitulative de prospection", { b: 1, sz: 32, c: "2F5A28" }), { centre: 1, apres: 40 }) + wPar(wRun(d.nom, { b: 1, sz: 22 }), { centre: 1, apres: 200 });
  b += wTable([["N° de prospection", d.code], ["Commune(s)", [...new Set(d.parcelles.map(p => p.commune).filter(Boolean))].join(", ") || "—"], ["Lieu-dit", d.donnees.lieu_dit || "—"], ["Gestionnaire", d.auteur], ["Créé le", d.cree],
    ["Parcelles", d.parcelles.length + " (" + Object.keys(n).map(k => n[k] + " " + TYPES[k].l.toLowerCase()).join(", ") + ")"], ["Surface totale", ha(surf)], ["Propriétaires", proprietairesDe(d).join(", ") || "Non renseignés"]], L2);
  b += wTitre("Parcelles");
  b += wTable([["Type", "Parcelle", "Contenance", "Propriétaire(s)", "Suivi"]].concat(d.parcelles.map(p => { const e = etatSuivi(p, d); return [TYPES[typeDe(p)].l, p.etat === "ok" ? `${p.commune}\n${sansZero(p.section)} ${sansZero(p.numero)}` : "À identifier", p.contenance ? ha(p.contenance) : "—", texteProprio(p), e.lib + (e.relance ? " (à relancer)" : "")]; })), [1500, 1900, 1300, 2200, 2172], true);
  themesUtiles(d).forEach(t => { b += wTitre(t.titre); b += wTable(t.champs.map(c => [c.l, valeurLisible(d, c.k) || "—"]), L2); });
  const ph = (await dbAll("photos")).filter(x => x.dossierId === d.id).length;
  if (ph) b += wPar(wRun(ph + " photo(s) dans le dossier Drive.", { sz: 18 }), { avant: 60 });
  b += wTitre("Réglementation communale");
  b += wTable(REGLES.map(r => [r.l, d.donnees[r.k] ? d.donnees[r.k] + (d.donnees[r.k] === "OUI" && d.donnees[r.k + "_detail"] ? " : " + d.donnees[r.k + "_detail"] : "") : "Non renseigné"]).concat([["Autre", d.donnees.regle_autre || "—"]]), L2);
  b += wTitre("Zonage réglementaire");
  const zs = zonagesDe(d);
  b += zs.length ? wTable(zs.map(z => [z.type, z.nom || "—"]), L2) : wPar(wRun("Aucun zonage trouvé dans les bases interrogées.", { sz: 18 }));
  b += wPar(wRun("Résultat automatique à confirmer auprès des services compétents.", { sz: 16, c: "6B6B6B" }), { avant: 40 });
  b += wTitre("Suivi détaillé");
  d.parcelles.forEach(p => {
    const f = suiviDe(p).f, rows = [["Date de prospection", frDate(datePros(p, d)) || "—"]];
    if ((f.email_proprio || {}).v || (f.tel_proprio || {}).v) rows.push(["Contact propriétaire", [(f.email_proprio || {}).v, (f.tel_proprio || {}).v].filter(Boolean).join(" · ")]);
    etapesDe(p).forEach(e => { const v = f[e.k] || {}; rows.push([e.l, v.v ? frDate(v.v) + (v.r ? " : " + v.r : "") : "—"]); });
    if (f.cloture && f.cloture.v) rows.push(["Clôture", f.cloture.r + " le " + frDate(f.cloture.v)]);
    suiviDe(p).notes.filter(x => !x.del).forEach(x => rows.push(["Note du " + frDate(x.date), x.txt]));
    b += wPar(wRun(`${TYPES[typeDe(p)].l} · ${titreParcelle(p)}`, { b: 1, sz: 20 }), { avant: 120, apres: 40, keep: 1 });
    b += wTable(rows, L2);
  });
  b += wPar(wRun("Fiche éditée le " + new Date().toLocaleDateString("fr-FR") + " depuis ProspectBois.", { sz: 16, c: "6B6B6B" }), { avant: 200 });
  const i = doc.indexOf("<w:body>") + 8, j = doc.lastIndexOf("<w:sectPr");
  doc = doc.slice(0, i) + b + doc.slice(j);
  z.file("word/document.xml", doc);
  const nom = `Fiche_recapitulative_${d.code}.docx`;
  return { id: d.id + ":" + nom, kind: "fiche", dossierId: d.id, nom, blob: await z.generateAsync({ type: "blob", mimeType: MIME_DOCX, compression: "DEFLATE" }) };
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
          Object.assign(r, { type: p.type, ajoute: p.ajoute, suivi: p.suivi });
          d.parcelles[i] = r; await chargerZonage(r); await chargerProprietaire(r); change = true;
          if (!d.commune) { d.commune = r.commune; d.insee = r.insee; d.nom = nomDossier(d); }
        } else if (p.proprioEtat === "attente" && d.auteurId === user.id) {
          await chargerProprietaire(p); change = change || p.proprioEtat !== "attente";
        }
      } catch (e) { /* toujours pas de reseau : nouvel essai plus tard */ }
    }
    if (change) {
      await dbPut("dossiers", d);
      if (d.enregistre) await fileDocuments(d);
      if (dossierCourant === d) afficherDossier();
    }
  }
}

// ---- Prospections sur la carte --------------------------------
function dessinerProspections() {
  if (!gProspections) return;
  gProspections.clearLayers();
  dossiers.forEach(d => {
    const initiales = String(d.auteur || "").split(/\s+/).map(x => x[0] || "").join("").toUpperCase();
    d.parcelles.forEach(p => {
      const t = TYPES[typeDe(p)], e = etatSuivi(p, d);
      const style = { color: t.c, weight: e.relance ? 3 : 2, dashArray: e.fini ? "4 4" : null, fillColor: t.c, fillOpacity: .32 };
      const c = p.geom ? L.geoJSON(p.geom, { style }) : L.circleMarker([p.lat, p.lng], Object.assign({ radius: 8 }, style));
      c.on("click", ev => {
        L.DomEvent.stopPropagation(ev);
        if (peutEditer() && outil !== "info") { clicCarte(ev.latlng); return; }
        ouvrirDossier(d, "fiche");
      });
      c.bindTooltip(`${d.nom} · ${t.l} · ${initiales}`, { direction: "top", className: "etiquette" });
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
  if (dossierCourant) { dossierCourant = null; vueDossier = "fiche"; gSel.clearLayers(); enAjout = false; if (outil === "saisie") choisirOutil("info"); }
};
$("btnCouches").onclick = panneauCouches;
// ---- Dossiers prospection ------------------------------------
let filtreDossiers = "tous", rechercheDossiers = "";
const sansAccent = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function texteRecherche(d) {
  return sansAccent([d.nom, d.code, d.commune, d.donnees.lieu_dit, d.auteur].concat(proprietairesDe(d), d.parcelles.map(p => sansZero(p.section) + " " + sansZero(p.numero) + " " + sansZero(p.section) + sansZero(p.numero))).join(" "));
}
function listeDossiers() {
  const f = [["tous", "En cours"], ["moi", "Mes dossiers"], ["relance", "À relancer"], ["brouillon", "Brouillons"], ["archives", "🗄 Archives"]];
  ouvrirSheet("Dossiers prospection", `<input id="dRech" type="search" placeholder="Commune, n°, propriétaire, parcelle…" value="${esc(rechercheDossiers)}"><div class="filtres">${f.map(([k, l]) => `<button type="button" data-filtre="${k}" class="${k === filtreDossiers ? "on" : ""}">${l}</button>`).join("")}</div><div class="chips legende">${Object.keys(TYPES).map(chipType).join("")}</div><div id="dListe"></div>`, true);
  $("dRech").oninput = e => { rechercheDossiers = e.target.value; rendreListe(); };
  $("sheetCorps").querySelectorAll("[data-filtre]").forEach(b => b.onclick = () => { filtreDossiers = b.dataset.filtre; $("sheetCorps").querySelectorAll("[data-filtre]").forEach(x => x.classList.toggle("on", x === b)); rendreListe(); });
  rendreListe();
}
function rendreListe() {
  if (filtreDossiers === "archives") { listeArchives(); return; }
  const q = sansAccent(rechercheDossiers).trim().split(/\s+/).filter(Boolean);
  const l = [...dossiers].reverse().filter(d => {
    if (filtreDossiers === "moi" && d.auteurId !== user.id) return false;
    if (filtreDossiers === "brouillon" && !d.brouillon) return false;
    if (filtreDossiers === "relance" && !d.parcelles.some(p => etatSuivi(p, d).relance)) return false;
    const t = texteRecherche(d); return q.every(m => t.includes(m));
  });
  const el = $("dListe"); if (!el) return;
  el.innerHTML = l.length ? l.map(d => {
    const n = comptesTypes(d), et = d.parcelles.map(p => etatSuivi(p, d)), rel = et.filter(e => e.relance).length, fin = et.filter(e => e.fini).length;
    return `<button class="dossier" data-d="${esc(d.id)}"><b>${esc(d.nom)}</b>${d.brouillon ? ` <span class="brouillon">brouillon</span>` : ""}<div class="chips">${Object.keys(n).map(k => chipType(k) + `<b class="nb">${n[k]}</b>`).join("")}</div><small>${esc(d.auteur)} · ${esc(d.cree)} · ${fin}/${d.parcelles.length} suivi(s) clos${rel ? ` · <span class="relance">${rel} à relancer</span>` : ""}</small></button>`;
  }).join("") : `<p class="note">${dossiers.length ? "Aucun dossier ne correspond." : "Aucun dossier. Déverrouillez le cadenas puis touchez Saisie."}</p>`;
  el.querySelectorAll("[data-d]").forEach(b => b.onclick = () => ouvrirDossier(dossiers.find(x => x.id === b.dataset.d)));
}
$("btnDossiers").onclick = listeDossiers;
$("btnCompte").onclick = async () => {
  const n = await nbAttente();
  ouvrirSheet(user.nom, `<div class="ligne"><span>Identifiant</span><span>${esc(user.id)}</span></div><div class="ligne"><span>En attente d'envoi</span><span>${n}</span></div><h3>Coordonnées reprises dans les courriers</h3><label for="cEmail">E-mail</label><input id="cEmail" type="email" value="${esc(user.email || "")}"><label for="cTel" style="margin-top:10px">Téléphone</label><input id="cTel" type="tel" value="${esc(user.tel || "")}"><button class="btn btn2" id="cProfil">Enregistrer mes coordonnées</button><h3>Suivi</h3><div class="ligne"><span>Rappel par e-mail après</span><span>${delaiRappel()} jours sans action</span></div><p class="note">Délai commun à l'équipe, modifiable dans l'onglet « Reglages » du Google Sheets.</p><h3>Application</h3><button class="btn btn2" id="cSync">🔄 Synchroniser</button>${user.sheetUrl ? `<a class="btn btn2" style="text-align:center;text-decoration:none" href="${esc(user.sheetUrl)}" target="_blank" rel="noopener">Ouvrir le Google Sheets</a>` : ""}<button class="btn danger" id="cDeco">Se déconnecter</button>`);
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
