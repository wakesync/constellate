export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/')){
   if(url.origin!==env.APP_ORIGIN)return new Response('Use canonical application URL',{status:403});
   const headers=new Headers(request.headers);
   for(const name of ['forwarded','x-forwarded-for','x-forwarded-host','x-forwarded-proto','x-real-ip','x-constellate-client-ip','x-constellate-origin-secret'])headers.delete(name);
   headers.set('x-constellate-client-ip',request.headers.get('cf-connecting-ip')||'unknown');
   headers.set('x-constellate-origin-secret',env.ORIGIN_PROXY_SECRET);
   const upstream=new URL(url.pathname+url.search,env.API_UPSTREAM);
   try{const r=await fetch(new Request(upstream,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,redirect:'manual'}));const out=new Response(r.body,r);out.headers.set('Strict-Transport-Security','max-age=31536000');out.headers.set('Cache-Control','no-store');return out;}catch{return Response.json({error:'Application temporarily unavailable'},{status:503});}
  }
  return env.ASSETS.fetch(request);
 }
};
