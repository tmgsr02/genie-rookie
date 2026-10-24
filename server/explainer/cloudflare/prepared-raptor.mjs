import descriptor from './raptor-manifest.mjs';
import {normalizePackage} from '../src/package.mjs';
export async function loadPreparedRaptor(bucket,request){
 const object=await bucket.get(descriptor.key);
 if(!object||object.size!==descriptor.bytes)throw Error('reference_asset_missing');
 const bytes=new Uint8Array(await object.arrayBuffer());
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 if(bytes.length!==descriptor.bytes||hash!==descriptor.sha256)throw Error('reference_digest_mismatch');
 const artifact=JSON.parse(new TextDecoder().decode(bytes));
 const pkg=normalizePackage(artifact.package,{scene_id:request.scene_id,scene_version:request.scene_version});
 const runtimeHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pkg.files['runtime.js']))),v=>v.toString(16).padStart(2,'0')).join('');
 if(runtimeHash!==descriptor.runtime_sha256)throw Error('reference_runtime_changed');
 if(!artifact.validation?.passed||!artifact.validation?.visual_review?.passed||!artifact.validation?.factual_review?.passed)throw Error('reference_review_missing');
 pkg.validation=artifact.validation;pkg.authoring_report=artifact.authoring_report;pkg.provenance='configured';
 return {package:pkg,metrics:{worker:'prepared_reference',reference:'raptor-full-flow',reference_sha256:hash}};
}
