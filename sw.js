// Application disponible hors ligne, et fonds de carte deja vus conserves.
const VERSION='pb6-4', APP='app-'+VERSION, TUILES='tuiles-v1', MAX_TUILES=6000;
const FICHIERS=['./','./index.html','./style.css','./config.js','./app.js','./modele_courrier.docx','./modele_passage.docx','./modele_passage_bois.docx','./manifest.webmanifest','./vendor/leaflet.js','./vendor/leaflet.css','./vendor/jszip.min.js','./vendor/images/marker-icon.png','./vendor/images/marker-icon-2x.png','./vendor/images/marker-shadow.png','./vendor/images/layers.png','./vendor/images/layers-2x.png','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(APP).then(c=>c.addAll(FICHIERS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('app-')&&k!==APP).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
async function reduire(c){const ks=await c.keys();for(let i=0;i<ks.length-MAX_TUILES;i++)await c.delete(ks[i]);}
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET')return;
  const u=new URL(r.url);
  if(u.origin===location.origin){
    // Le reseau d'abord pour recevoir les mises a jour, le cache si pas de reseau.
    e.respondWith(fetch(r).then(x=>{if(x.ok){const y=x.clone();caches.open(APP).then(c=>c.put(r,y));}return x;}).catch(()=>caches.match(r,{ignoreSearch:true})));
    return;
  }
  if(u.hostname==='data.geopf.fr'&&/GetTile/i.test(u.search)){
    e.respondWith(caches.open(TUILES).then(async c=>{
      const hit=await c.match(r.url);if(hit)return hit;
      try{
        const x=await fetch(r.url,{mode:'cors'});
        if(x.ok){await c.put(r.url,x.clone());if(Math.random()<.02)reduire(c);}
        return x;
      }catch(err){return fetch(r);}
    }));
  }
});
