export function delay(ms, value, {signal} = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const done=()=>{signal?.removeEventListener('abort',abort);resolve(value);};
    const timer=setTimeout(done,ms);
    const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal.reason);};
    signal?.addEventListener('abort',abort,{once:true});
  });
}
