// Interpreter for this service's deliberately small JSON-schema dialect.
// Workers prohibit runtime code generation; authored schemas cannot be compiled
// ahead of time. Keep semantics explicit and shared with the Node validator.
const equal = (a,b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a)!==Array.isArray(b)) return false;
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length && keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));
};
export function compile(schema) {
  const validate = value => {
    const errors=[];
    const add=(instancePath,keyword,message)=>{if(errors.length<32)errors.push({instancePath,keyword,message});};
    const visit=(s,v,path,depth=0)=>{
      if(depth>32) {add(path,'depth','maximum validation depth exceeded');return;}
      if(s.enum && !s.enum.some(x=>equal(x,v))) add(path,'enum','must equal an allowed value');
      const type=s.type;
      const good=type===undefined || (type==='null'?v===null:type==='array'?Array.isArray(v):type==='object'?v!==null&&typeof v==='object'&&!Array.isArray(v):type==='integer'?Number.isInteger(v):type==='number'?Number.isFinite(v):typeof v===type);
      if(!good){add(path,'type','must be '+type);return;}
      if(v!==null && typeof v==='object' && !Array.isArray(v)) {
        for(const key of s.required||[]) if(!Object.hasOwn(v,key)) add(path,'required','missing '+key);
        for(const key of Object.keys(v)) {
          const childPath=path+'/'+key.replaceAll('~','~0').replaceAll('/','~1');
          if(Object.hasOwn(s.properties||{},key)) visit(s.properties[key],v[key],childPath,depth+1);
          else if(s.additionalProperties===false) add(childPath,'additionalProperties','unexpected property');
        }
      }
      if(Array.isArray(v)) {
        if(s.minItems!==undefined && v.length<s.minItems) add(path,'minItems','too few items');
        if(s.maxItems!==undefined && v.length>s.maxItems) add(path,'maxItems','too many items');
        if(s.items) for(let i=0;i<v.length;i++) visit(s.items,v[i],path+'/'+i,depth+1);
      }
      if(typeof v==='string') {
        const length=Array.from(v).length;
        if(s.minLength!==undefined && length<s.minLength) add(path,'minLength','string too short');
        if(s.maxLength!==undefined && length>s.maxLength) add(path,'maxLength','string too long');
        if(s.pattern!==undefined && !new RegExp(s.pattern,'u').test(v)) add(path,'pattern','string does not match pattern');
      }
      if(typeof v==='number') {
        if(!Number.isFinite(v)) add(path,'type','must be finite');
        if(s.minimum!==undefined && v<s.minimum) add(path,'minimum','number too small');
        if(s.maximum!==undefined && v>s.maximum) add(path,'maximum','number too large');
      }
    };
    visit(schema,value,'');
    validate.errors=errors.length?errors:null;
    return errors.length===0;
  };
  validate.errors=null;
  return validate;
}
