import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSchema, object, checkDialect, ajv} from '../src/contracts.mjs';

test('contracts validate without runtime code generation', () => {
  const original = globalThis.Function;
  globalThis.Function = function () { throw Error('runtime_codegen_forbidden'); };
  try {
    const schema = object({n:{type:'integer',minimum:1,maximum:4},label:{type:'string',maxLength:4},paused:{type:'boolean'}});
    assert.deepEqual(assertSchema(schema,{n:2,label:'ok',paused:false}),{n:2,label:'ok',paused:false});
    assert.throws(()=>assertSchema(schema,{n:5,label:'ok',paused:false}),/Invalid request schema/);
  } finally {globalThis.Function=original;}
});
test('portable validator enforces supported nested bounds and own properties', () => {
  const schema=object({items:{type:'array',minItems:1,maxItems:2,items:object({value:{type:'string',minLength:1,maxLength:2,enum:['a','bb']}})}});
  const validate=ajv.compile(schema);
  assert.equal(validate({items:[{value:'bb'}]}),true);
  for(const value of [{items:[]},{items:[{value:'c'}]},{items:[{value:'a',extra:1}]},{items:[{value:'a'}],extra:1},Object.create({items:[{value:'a'}]})]) assert.equal(validate(value),false);
});
test('dialect rejects malformed schemas before authored code executes', () => {
  for(const schema of [
    {type:'object',additionalProperties:false,properties:{},required:'bad'},
    {type:'string',maxLength:-1},
    {type:'integer',minimum:3,maximum:1},
    {type:'array',maxItems:2,items:{type:'boolean'},minItems:3},
  ]) assert.throws(()=>checkDialect(schema));
});

test('restricted dialect interpreter matches Ajv on bounded JSON values', async () => {
  const {default:Ajv}=await import('ajv');
  const reference=new Ajv({strict:false,ownProperties:true});
  const schema=object({n:{type:'number',minimum:-2,maximum:3},text:{type:'string',minLength:1,maxLength:2},choices:{type:'array',maxItems:2,items:{type:'integer',minimum:0,maximum:2}}});
  const expected=reference.compile(schema), actual=ajv.compile(schema);
  for(const n of [-3,-2,0,2.5,3,4,null,'1']) for(const text of ['', 'é', '😀', 'abc', 1]) for(const choices of [[],[0],[2,1],[3],[1,2,0],null]) {
    const value={n,text,choices}; assert.equal(actual(value),expected(value),JSON.stringify(value));
  }
});
