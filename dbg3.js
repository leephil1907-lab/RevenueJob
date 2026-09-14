const fs=require('fs'); const path=require('path'); const {join}=path;
const ROOT=__dirname;   // the checkout this script lives in
const {JSDOM, VirtualConsole}=require('jsdom');
const html=fs.readFileSync(join(ROOT, 'index.html'),'utf8');
const errs=[]; const vc=new VirtualConsole();
vc.on('jsdomError',e=>errs.push(((e&&e.stack)||String(e)).split('\n').slice(0,4).join(' | ')));
vc.on('error',(...a)=>errs.push('console.error: '+a.join(' ')));
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,url:'https://example.com/',
 beforeParse(win){
  win.matchMedia=q=>({matches:false,media:q,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  win.IntersectionObserver=class{constructor(cb){this.cb=cb}observe(){}unobserve(){}disconnect(){}};
  win.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
  win.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16);
  win.cancelAnimationFrame=id=>clearTimeout(id);
  win.requestIdleCallback=cb=>setTimeout(()=>cb({didTimeout:false}),20);
  const ctx=new Proxy({},{get:(t,k)=>/createLinearGradient|createRadialGradient/.test(k)?()=>({addColorStop(){}}):()=>{},set:()=>true});
  win.HTMLCanvasElement.prototype.getContext=()=>ctx;
  win.SVGElement.prototype.getTotalLength=()=>120;
  win.SVGElement.prototype.getPointAtLength=()=>({x:1,y:1});
  win.Element.prototype.getBoundingClientRect=()=>({top:100,left:0,right:900,bottom:400,width:900,height:300,x:0,y:100});
  win.WebGLRenderingContext=function(){};
 }});
setTimeout(()=>{
 const w=dom.window;
 console.log('RP:',!!w.RP,'calc:',!!(w.RP&&w.RP.calc),'os:',!!(w.RP&&w.RP.os),'OrbEngine:',!!w.OrbEngine);
 console.log('errors:'); errs.slice(0,6).forEach(e=>console.log('  -',e));
 process.exit(0);
},900);
