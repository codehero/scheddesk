var child_process = require("child_process");
var fs = require("fs");
var util = require("util");
var path = require("path");

exports.executeChild = function(cdb, triggerID, dequeueID, task, taskRunData, trig, opts)
{
	var options = {
		"cwd": taskRunData.cwd || opts.defaultCWD
	};

	/* Initialized environment. */
	options.env = {};
	for(var x in process.env){
		options.env[x] = process.env[x];
	}
	if(taskRunData.env){
		for(var x in taskRunData.env){
			options.env[x] = taskRunData.env[x];
		}
	}
	options.env.TRIGGER_ID = triggerID;

	var tmpDir = taskRunData.tmpDir || opts.tmpDir;

	/* Add temporary file names. */
	if("tempFiles" in task){
		var base = path.join(tmpDir, "TMPFILE_" + dequeueID);
		for(var i = 0; i < task.tempFiles.length; ++i){
			options.env["TMPFILE_" + i] = base + "." + i;
		}
	}
	if("tempDirs" in task){
		var base = path.join(tmpDir, "TMPDIR_" + dequeueID);
		for(var i = 0; i < task.tempDirs.length; ++i){
			options.env["TMPDIR_" + i] = base + "." + i;
		}
	}

	var proc = child_process.spawn(taskRunData.command, taskRunData.args, options);
	var sout = fs.createWriteStream(path.join(tmpDir, "lastStdOut"));
	var serr = fs.createWriteStream(path.join(tmpDir, "lastStdErr"));
	proc.stdout.pipe(sout);
	proc.stderr.pipe(serr);

	proc.on("exit", function(code){
		util.debug("Exited with code " + code);
		if(!task.taskType.filesTermination){
			var ts = new Date().getTime();

			if(!code){
				var doc = cdb.doc("scheddesk.termination." + ts);
				doc.body = {
					"_id" : "scheddesk.termination." + ts,
					"timestamp" : ts,
					"triggerID" : triggerID,
					"dequeueID" : dequeueID
				};
				util.debug("Saving termination: " + JSON.stringify(doc));
				doc.save(function(err, d){
					util.debug("Saved termination: ");
					if(err){
						/* TODO */
						util.debug("Saving termination error: " + JSON.stringify(err));
					}
					else{
						/* TODO */
					}
				});
			}
			else{
				var errID = "scheddesk.exitCodeError." + ts;
				var errDoc = cdb.doc(errID);
				errDoc.body = {
					"_id" : errID,
					"code" : code,
					"scheddesk_err_report":{
						"timestamp" : ts,
						"triggerID" : triggerID,
						"dequeueID" : dequeueID
					}
				};

				errDoc.save(function(err, d){
					util.debug("Saved error report");
					if(err){
						/* TODO */
						util.debug("Saving termination error: " + JSON.stringify(err));
					}
					else{
						/* Save temporary files as attachments. */

						var tempFileCount = (task.tempFiles && task.tempFiles.length) || 0;
						var tempDirCount = (task.tempDirs && task.tempDirs.length) || 0;
						if(task.tempFiles || task.tempDirs){
							var baseFile = path.join(tmpDir, "TMPFILE_" + dequeueID);
							var baseDir = path.join(tmpDir, "TMPDIR_" + dequeueID);

							function saveDirectory(dirCounter, cb){
								if(dirCounter == tempDirCount){
									if(cb)
										cb();
									return;
								}

								var dirPath= baseDir + "." + dirCounter;
								util.debug("Saving dir " + dirPath);
								try{
									fs.statSync(dirPath);

									/* Compose attachment parameters. */
									var diag = task.tempDirs[dirCounter];
									var adir = "TMPDIR_" + dirCounter;
									var mime = "application/x-tar";
									var attach = errDoc.attachment(adir);

									/* Start tar process to archive files. */
									var args = [
										"-cf", "-",
										"-C", dirPath,
										"."
									];

									var tarProc = child_process.spawn("tar", args);
									tarProc.on("exit", function(code){
										if(code){
											util.debug("Tar archive of " + dirPath + " failed with " + code);
										}
									});

									/* Attach body to tar stdout. */
									attach.setBody(mime, tarProc.stdout);
									attach.save(function(err, response){
										if(err){
											/* TODO Sa*/
											util.debug("Saving err attachment: " + JSON.stringify(err));
										}

										saveDirectory(dirCounter + 1, cb);
									});
								}
								catch(e){
									/* TODO handle error if tar doesn't work!!! */
									util.debug("Tar execution error " + e.message);
									saveDirectory(dirCounter + 1, cb);
								}
							}

							function saveAttachment(counter, cb){
								if(counter == tempFileCount){
									if(cb)
										cb();
									return;
								}

								/* Make sure that temp file exists. */
								var filename = baseFile + "." + counter;
								util.debug("Saving file " + filename);
								try{
									fs.statSync(filename);
								}
								catch(e){
									saveAttachment(counter + 1, cb);
									return;
								}

								/* Compose attachment parameters. */
								var diag = task.tempFiles[counter];
								var afile = "TMPFILE_"+counter;
								var mime = diag.mime;
								var attach = errDoc.attachment(afile);
								attach.setBody(mime, fs.createReadStream(filename));
								attach.save(function(err, response){
									if(err){
										/* TODO Sa*/
										util.debug("Saving err attachment: " + JSON.stringify(err));
									}
									else{
										util.debug("Saved attachment: " + counter + " " +response);
										saveAttachment(counter + 1, cb);
									}
								});
							}

							var outputs = [
								"lastStdOut",
								"lastStdErr"
							];

							function saveOutput(counter, cb){
								if(counter == outputs.length){
									if(cb)
										cb();
									return;
								}

								/* Make sure that temp file exists. */
								var filename = path.join(tmpDir, outputs[counter]);
								util.debug("Saving file " + filename);
								try{
									fs.statSync(filename);
								}
								catch(e){
									saveOutput(counter + 1, cb);
									return;
								}

								/* Compose attachment parameters. */
								var mime = "text/plain";
								var attach = errDoc.attachment(outputs[counter]);
								attach.setBody(mime, fs.createReadStream(filename));
								attach.save(function(err, response){
									if(err){
										/* TODO Sa*/
										util.debug("Saving err output attachment: " + JSON.stringify(err));
									}
									else{
										util.debug("Saved output attachment: " + counter + " " +response);
										saveOutput(counter + 1, cb);
									}
								});

							}

							saveOutput(0, function(){
								saveAttachment(0, function(){
									saveDirectory(0);
								});
							});
						}
					}
				});
			}
		}
	});

}
