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
