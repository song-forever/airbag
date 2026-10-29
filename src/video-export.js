const formats={
 'video/mp4':{extension:'mp4',type:'video/mp4'},
 'video/quicktime':{extension:'mov',type:'video/quicktime'},
 'video/webm':{extension:'webm',type:'video/webm'},
 'video/x-m4v':{extension:'m4v',type:'video/x-m4v'},
};
export function makeVideoFile(record,{FileImpl=File}={}){
 if(!(record?.blob instanceof Blob)||!record.blob.size)throw new Error('这条记录没有可下载的视频。');
 const mime=record.blob.type.split(';')[0].toLowerCase();
 const suffix=/\.(mp4|mov|webm|m4v)$/i.exec(record.name||'')?.[1]?.toLowerCase();
 const format=formats[mime]||Object.values(formats).find(item=>item.extension===suffix)||formats['video/mp4'];
 const date=new Date(record.createdAt);const stamp=(Number.isFinite(date.getTime())?date:new Date()).toISOString().replace(/[:.]/g,'-');
 return new FileImpl([record.blob],'跃练-'+stamp+'.'+format.extension,{type:format.type});
}
export function canShareVideo(file,navigatorImpl=navigator){
 try{return typeof navigatorImpl.share==='function'&&typeof navigatorImpl.canShare==='function'&&navigatorImpl.canShare({files:[file]});}catch{return false;}
}

export function hasVideo(record){return record?.blob instanceof Blob&&record.blob.size>0;}
export async function exportVideoBatch(records,{navigatorImpl=navigator,confirmSaved=()=>false,clearVideos=async()=>{}}={}){
 if(!records.length||records.some(record=>!hasVideo(record)))throw new Error('请选择仍保存在本机的视频。');
 const files=records.map((record,index)=>{const file=makeVideoFile(record);return new File([file],String(index+1).padStart(3,'0')+'-'+file.name,{type:file.type});});
 if(typeof navigatorImpl.share!=='function'||!navigatorImpl.canShare?.({files}))throw new Error('当前浏览器无法一次保存这些视频，请减少选择数量，或使用 iPhone Safari。');
 await navigatorImpl.share({files,title:'跃练批量视频'});
 if(!await confirmSaved())return {exported:records.length,cleared:0};
 await clearVideos(records);
 return {exported:records.length,cleared:records.length};
}
