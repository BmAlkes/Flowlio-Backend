const {test}=require('node:test');
const assert=require('node:assert/strict');
const {audioFileName,transcriptionUsage,transcribe,MAX_AUDIO_BYTES}=require('../src/modules/agent/transcribe');

test('recorded containers keep a file name the transcription model can read',()=>{
 assert.equal(audioFileName('audio/webm;codecs=opus'),'voice.webm');
 assert.equal(audioFileName('audio/mp4'),'voice.m4a');
 assert.equal(audioFileName('audio/ogg; codecs=opus'),'voice.ogg');
 assert.equal(audioFileName('AUDIO/MPEG'),'voice.mp3');
 for(const bad of ['image/png','application/pdf','text/plain',''])assert.throws(()=>audioFileName(bad),{code:'AUDIO_UNSUPPORTED'});
});

test('usage is charged from the provider tokens, or estimated from the duration when only that is reported',()=>{
 assert.deepEqual(transcriptionUsage({type:'tokens',input_tokens:120,output_tokens:30,total_tokens:150},'hi'),{promptTokens:120,completionTokens:30,totalTokens:150});
 assert.deepEqual(transcriptionUsage({type:'duration',seconds:10},'abcd'),{promptTokens:250,completionTokens:2,totalTokens:252});
 assert.equal(transcriptionUsage(undefined,'').totalTokens,3000);
});

test('empty, oversized or non-audio uploads are refused before the provider is called',async()=>{
 let called=false;const call=async()=>{called=true;return{text:'never'};};
 await assert.rejects(transcribe({buffer:Buffer.alloc(0),mimetype:'audio/webm'},undefined,call),{code:'AUDIO_EMPTY'});
 await assert.rejects(transcribe({buffer:Buffer.alloc(MAX_AUDIO_BYTES+1),mimetype:'audio/webm'},undefined,call),{code:'AUDIO_TOO_LARGE'});
 await assert.rejects(transcribe({buffer:Buffer.from('x'),mimetype:'image/png'},undefined,call),{code:'AUDIO_UNSUPPORTED'});
 assert.equal(called,false);
});
