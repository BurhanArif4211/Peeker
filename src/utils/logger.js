
function info (str){
	console.log(`[INFO] ${str}`);
}
function error (str,errorHandler){
	console.log(`[ERR] ${str}`, errorHandler);
}
function warn (str,errorHandler){
	console.log(`[WARN] ${str}`, errorHandler);
}
function debug (str,errorHandler){
	console.log(`[DEBUG] ${str}`, errorHandler);
}

export {info,error,debug,warn};
