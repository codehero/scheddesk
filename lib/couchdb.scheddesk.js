/* Copyright (c) 2010 David Bender assigned to Benegon Enterprises LLC
 * See the file LICENSE for full license information.
 *
 * CouchDB Database Backend
 * */

var couchdb = require("couchdb-api");
var util = require("util");
var fs = require("fs");
var path = require("path");
var inherits = require("util").inherits;
var EventEmitter = require("events").EventEmitter;
var child_process = require("child_process");
var nodemailer = require("nodemailer");

var childAux = require("./childExecution");

var TRIGGER_BIT = {
	"ENQUEUED" : 0x1,
	"DEQUEUED" : 0x2,
	"TERMINATED" : 0x8,
	"ERROR" : 0x4
};

/* This class is a CouchDB backend. */
var CouchDatabase = function(conf, seq){
	EventEmitter.call(this);

	/* Install the db. */

	this._conf = conf;
	this._couchClient = couchdb.srv(conf.host, conf.port);
	
	this._couchClient.auth = conf.user +":"+ conf.password;

	this._db = this._couchClient.db(conf.dbName);

	this._executingTrigger = null;
	this._dequeueTimeout = null;

	/* Make sure some key configuration variables are defined. */
	var essentials = [
		"tmpDir",
		"taskDir"
	];

	for(var i = 0; i < essentials.length; ++i){
		if(!(essentials[i] in this._conf))
			throw new Error("Configuration is missing " + essentials[i] + "!");
	}

	/* Convenient locals. */
	var _this = this;
	var cdb = this._db;

	/* Clear out any tasks that the DB still thinks are running. */
	_this._getUncompletedTasks(function(err, stateQuery){
		if(err){
			util.debug("ERROR2 " + JSON.stringify(err));
		}
		else{
			util.debug("RESULT " + JSON.stringify(stateQuery));
			_this._cleanupOldRunning(stateQuery, function(err){
				if(err){
					util.debug("ERROR3 " + JSON.stringify(err));
				}

				/* Begin listening for changes and for when the next trigger to execute. */
				cdb.info(function(err, data){
					if(err){
						/* TODO */
						util.debug("INFO error " + JSON.stringify(err));
					}
					else{

						/*  */
						_this._listenForChanges(data.update_seq);
						_this._waitForNextDequeue();
					}
				});
			});
		}
	});

	return this;
}
inherits(CouchDatabase, EventEmitter);

CouchDatabase.prototype._listenForChanges = function(last_seq){
	var _this = this;
	var opts = {
		"since":last_seq,
		"filter":"SchedDeskApp/changesFilter",
		"feed":"continuous",
		"include_docs":true
	};

	var cdb = this._db;
	cdb.changes(opts, function(err, changeStream){
		changeStream.on("change", function(change){
			_this._onChange(change);
		});

		changeStream.on("end", function(){
			util.debug("CHANGESTREAM ENDED");
		});

		changeStream.on("error", function(err){
			util.debug("CHANGESTREAM ERROR: " + err);
		});

		changeStream.on("last", function(last_seq){
			util.debug("CHANGESTREAM last_seq " + last_seq);
			opts.since = last_seq;
			_this._listenForChanges(last_seq);
		});

	});
}

CouchDatabase.prototype._executeTrigger = function(triggerID, trig, dequeueID){
	util.debug("_executeTrigger " + this._executingTrigger);
	if(this._executingTrigger){
		/* BUG */
		util.debug("BUG X4");
		return;
	}
	this._executingTrigger = triggerID;


	/* Get the task definiton. */
	var cdb = this._db;
	var _this = this;

	/* If taskDefinition is just retry, then nullifying a dequeue. */
	if(trig.taskDefinition == "scheddesk.retry"){
		var ts = new Date().getTime();
		var doc = cdb.doc("scheddesk.termination." + ts);
		doc.body = {
			"_id" : "scheddesk.termination." + ts,
			"triggerID" :  triggerID,
			"dequeueID" : dequeueID,
			"timestamp" : ts,
			"scheddesk_retry" : {
				"triggerID" :  trig.retryTriggerID,
				"dequeueID" :  trig.retryDequeueID
			}
		};

		doc.save(function(err, data){
			/* Updated State, have to recalculate triggers. */
			if(err){
				util.debug("Save retry " + JSON.stringify(err));
			}
		});

		return;
	}

	/* Determine day, month, year according to locale. */
	var NOW = new Date();
	NOW = new Date(NOW.getTime() - NOW.getTimezoneOffset() * 60000);

	util.debug("Getting task definition " + trig.taskDefinition);
	var taskDef = cdb.doc(trig.taskDefinition);
	taskDef.get(function(err, task){
		/* If we cannot get the task definition, we certainly cannot execute!*/
		if(err){
			util.debug("Get Task Data " + JSON.stringify(err));
			if(err.error == "not_found"){
				_this._executingTrigger = null;
			}
			else{
				/* Some comm error, retry.. */
				/* TODO */
			}
			return;
		}

		/* Execute according to task definition. */
		if(task.taskType == "child_process"){
			/* Load the corresponding JSON description. */
			var defPath = path.join(_this._conf.taskDir, task._id + ".json"); 
			fs.readFile(defPath,
				function(err, data){
					try{
						if(err)
							throw err;

						var taskRunData = JSON.parse(data);

						/* If environment file is specified, then load it. */
						if("env" in taskRunData){
							if(typeof taskRunData.env == "string"){
								/* Attempt to load the file.
								 * FIXME do not load synchronously, _execute_child should take a cb.*/
								taskRunData.env =
									JSON.parse(fs.readFileSync(path.join(_this._conf.taskDir, taskRunData.env)));
							}
							else if(typeof v == "object"){
								/* Not much to check.. */
							}
							else
								throw new Error("Invalid environment specification!");
						}

						/* Add year, month, and day. */
						taskRunData.env.SCHEDDESK_YEAR = NOW.getUTCFullYear();
						taskRunData.env.SCHEDDESK_MONTH = NOW.getUTCMonth();
						taskRunData.env.SCHEDDESK_DAY = NOW.getUTCDate();
						taskRunData.env.SCHEDDESK_MSOFFSET = -NOW.getTimezoneOffset() * 60000;

						childAux.executeChild(cdb, triggerID, dequeueID, task, taskRunData,
							trig, {
								"defaultCWD" : _this._conf.defaultCWD,
								"tmpDir" : _this._conf.tmpDir
							});
					}
					catch(e){
						/* Cannot run the process without the definition! */
						var ts = new Date().getTime();
						var errID = "scheddesk.error." + ts;
						var errDoc = cdb.doc(errID);
						errDoc.body = {
							"_id" : errID,
							"data":[
								"taskDefinitionNotFound",
								{
									"message" : e.message,
									"file" : defPath
								}
							],

							"scheddesk_err_report":{
								"timestamp" : ts,
								"triggerID" : triggerID,
								"dequeueID" : dequeueID
							}
						};

						errDoc.save(function(err, d){
							if(err)
								util.debug("Could not save error, error: " + JSON.stringify(errDoc.body));
						});
					}
				}
			);
		}
		else if(task.taskType == "notification"){
			if("email" in trig){

				/* Get email configuration. */
				var smtpConfig = cdb.doc("scheddesk.emailConfig.0");
				smtpConfig.get(function(err, cfg){
					nodemailer.SMTP = cfg.SMTP;
					if(_this.conf.SMTP_Auth){
						nodemailer.SMTP.use_authentication = true;
						nodemailer.SMTP.user = _this.conf.user;
						nodemailer.SMTP.pass = _this.conf.pass;
					}

					/* FIXME: Use notification configuration.
					 * Sender name should indicate routine name. */
					var email = {
						"sender" : cfg.sender,
						"to" : cfg.recipient,
						"subject" : cfg.subject,
						"body" : "An error occurred"
					};
					nodemailer.send_email(email, function(error, success){
							var ts = new Date().getTime();

							if(error){
								var errID = "scheddesk.error." + ts;
								var errDoc = cdb.doc(errID);
								errDoc.body = {
									"_id" : errID,
									"data":[
										"notificationError",
										{
											"message" : error + "",
											"email" : email
										}
									],
									"scheddesk_err_report":{
										"timestamp" : ts,
										"triggerID" : triggerID,
										"dequeueID" : dequeueID
									}
								};

								errDoc.save(function(err, d){
									if(err)
										util.debug("Could not save email error, error: " + JSON.stringify(err));
								});
								return;
							}

							var doc = cdb.doc("scheddesk.termination." + ts);
							doc.body = {
								"_id" : "scheddesk.termination." + ts,
								"timestamp" : ts,
								"triggerID" : triggerID,
								"dequeueID" : dequeueID
							};
							doc.save(function(err, d){
								if(err){
									/* TODO */
									util.debug("Saving termination error: " + JSON.stringify(err));
								}
							});
						}
					);
				});
			}
			else{
				util.debug("Unknown notification type!");
				_this._executingTrigger = null;
				_this._updateTrigger(triggerID);
			}
		}
		else {
			util.debug("Unknown task type!");
			_this._executingTrigger = null;
			_this._updateTrigger(triggerID);
		}
	});
}

CouchDatabase.prototype._onChange = function(change){
	var _this = this;

	util.debug("CHANGE " + change.id);

	var doc = change.doc;

	var parts = change.id.split(".");
	if(parts[0] == "scheddesk"){
		switch(parts[1]){
			case "routine":
				/* If not executing a trigger,
				 * then need to determine what next trigger is. */
				if(!_this._executingTrigger){
					util.debug("NEW ROUTINE DURING IDLE ");
					_this._waitForNextDequeue();
				}
				break;

			case "taskDefinition":
				/* Nothing to report really, good to know I guess. */
				break;

			case "dequeue":
				util.debug("DEQUEUE TRIGGER " + change.doc.triggerID);
				var triggerDoc = _this._db.doc(change.doc.triggerID);
				triggerDoc.get(function(err, doc){
					if(err){
						/* Couldn't get trigger doc, */
						util.debug("_onChange: " + err.message);
					}
					else{
						_this._executeTrigger(change.doc.triggerID,
							doc.scheddesk_trigger, change.id);
					}
				});
				break;

			case "termination":
				if(change.doc.triggerID == _this._executingTrigger){
					_this._executingTrigger = null;
					_this._waitForNextDequeue();
					return;
				}
				break;

			default:
				break;
		}
	}

	if("scheddesk_err_report" in doc){
		if(change.doc.scheddesk_err_report.triggerID == _this._executingTrigger){
			_this._executingTrigger = null;
			_this._waitForNextDequeue();
			return;
		}
	}

	if("scheddesk_trigger" in doc){
		/* If no trigger running then */
		if(!_this._executingTrigger){
			util.debug("NEW TRIGGER DURING IDLE ");
			_this._waitForNextDequeue();
		}
	}
}

CouchDatabase.prototype._submitTrigger = function(trigger, cb){
	var cdb = this._db;
	util.debug("SCHEDULED TIME IS " + trigger.scheddesk_trigger.scheduledTime);
	util.debug("Saving trigger " + JSON.stringify(trigger));
	var doc = cdb.doc(trigger._id);
	doc.body = trigger;
	doc.save(function(err, d){
		if(err){
			/* TODO */
			util.debug("Saving trigger error " + JSON.stringify(err));
		}
		else{
			/* Nothing to do, wait for couch notification... */
		}
		if(cb)
			cb(err);
	});
}

CouchDatabase.prototype._getNextRoutineTimes = function(cb){
	var _this = this;
	var cdb = this._db;
	var ddoc = cdb.ddoc("SchedDeskApp");

	var local = new Date();
	local = local.getTime();

	util.debug("Getting routine times with local time of " + local);

	ddoc.view("Schedule").list("NextTimes",
		{
			"include_docs" : true,
			"reduce" : false,
			"local" : local
		},
		function(err, q){
			if(!err){
				try{
					q = JSON.parse(q);
				}
				catch(e){
					err = e;
				}
			}

			if(err)
				cb(err);
			else
				cb(null, q);
		}
	);
}

CouchDatabase.prototype._getUncompletedTasks = function(cb){
	var _this = this;
	var cdb = this._db;
	var ddoc = cdb.ddoc("SchedDeskApp");

	ddoc.view("State").list("StateQuery",
		{
			"op" : "lt",
			"maskValue" : "0x" + (TRIGGER_BIT.TERMINATED).toString(16),
			"reduce" : true,
			"group" : true
		},
		function(err, q){
			if(!err){
				try{
					q = JSON.parse(q);
				}
				catch(e){
					err = e;
				}
			}

			if(err)
				cb(err);
			else
				cb(null, q);
		}
	);
}

CouchDatabase.prototype._cleanupOldRunning = function(stateQuery, cb){
	var _this = this;

	var runningCount = 0;
	function onAbort(err, doc){
		--runningCount;
		if(0 == runningCount){
			cb();
		}
	};

	var ts = new Date().getTime();
	for(var i = 0; i < stateQuery.length; ++i){
		/* Any triggers currently running should be forcefully aborted.
		 * Note that the DEQUEUE should be the latest update so 
		 * we will have the ID in the row. */
		if((TRIGGER_BIT.DEQUEUED | TRIGGER_BIT.ENQUEUED) == stateQuery[i].value.mask){
			++runningCount;
			var id = "scheddesk.error."+ ts +"."+ runningCount;
			var doc = _this._db.doc(id);
			doc.body = {
				"_id" : id,
				"data":[
					"forcedAbort",
					{
						"message" : "Task was found in run state on server startup."
					}
				],
				"scheddesk_err_report":{
					"timestamp" : ts,
					"triggerID" : stateQuery[i].key,
					"dequeueID" : stateQuery[i]._id
				}
			};
			doc.save(onAbort);
		}
	}

	if(0 == runningCount)
		cb();
}

CouchDatabase.prototype._getWaitingTasks = function(cb){
	var _this = this;
	var cdb = this._db;

	_this._getUncompletedTasks(function(err, stateQuery){
		var enqueued = [];
		for(var i = 0; i < stateQuery.length; ++i){
			util.debug("MASK VALUE IS " + stateQuery[i].value.mask);
			if(0 == (TRIGGER_BIT.DEQUEUED & stateQuery[i].value.mask)){
				enqueued.push(stateQuery[i].key);
			}
		}

		_this._db.allDocs({"include_docs":true}, enqueued, function(err, mdocs){
			if(err){
				cb(err, null);
				return;
			}

			var ret = {};

			/* Populate triggers directly, call update trigger function
			 * to write out state file. */
			for(var i = 0; i < mdocs.rows.length; ++i)
				ret[mdocs.rows[i].doc._id] = mdocs.rows[i].doc.scheddesk_trigger;

			cb(null, ret);
		});
	});

}

CouchDatabase.prototype._waitForNextDequeue = function(){
	var cdb = this._db;
	var _this = this;

	/* Clear pending timeout. */
	if(_this._dequeueTimeout){
		clearTimeout(_this._dequeueTimeout);
		_this._dequeueTimeout = null;
	}

	_this._getWaitingTasks(function(err, waitingTriggers){
		if(err){
			util.debug("_waitForNextDequeue 1: " + err.message);
		}
		else{
			util.debug("_waitForNextDequeue waiting : " + JSON.stringify(waitingTriggers));
			/* Find minimum */
			var minTaskTime = Infinity;
			var minTask = null;
			for(var i in waitingTriggers){
				if(waitingTriggers[i].scheduledTime < minTaskTime){
					minTask = i;
					minTaskTime = waitingTriggers[i].scheduledTime;
				}
			}

			/* Get scheduled times */
			_this._getNextRoutineTimes(function(err, timeList){
				if(err){
					util.debug("_waitForNextDequeue 2: " + err.message);
					return;
				}
				util.debug("_waitForNextDequeue routines : " + JSON.stringify(timeList));

				/* Pick the minimum of the two lists. */
				var nextTime = Infinity;
				var nextRoutine = null;

				for(var i = 0; i < timeList.length; ++i){
					var r = timeList[i].routine;

					/* TODO exclude routines that already have waiting tasks. */

					if(timeList[i].ts < nextTime){
						nextRoutine = r;
						nextTime = timeList[i].ts;
					}
				}

				util.debug("_waitForNextDequeue TASK: " + JSON.stringify(minTask));
				util.debug("_waitForNextDequeue ROUTINE: " + JSON.stringify(nextRoutine));
				if(nextRoutine || minTask){
					var now = new Date().getTime();

					/* Existing tasks win over scheduled tasks. */
					if(nextTime < minTaskTime){
						/* Create a new trigger and rerun the function. */
						_this._submitTrigger(
							{
								"_id" : "scheddesk.timedTrigger." + nextTime,
								"scheddesk_trigger" : {
									"timestamp" : now,
									"taskDefinition" : nextRoutine.taskID,
									"scheduledTime" : nextTime
								}
							},
							function(err){
								if(err){
									/* Didn't commit the trigger, no frickin clue what to. */
									/* Just bail to avoid infinite loop. */
									util.debug("_waitForNextDequeue 3: " + err.message);
								}
							}
						);
					}
					else{
						util.debug("Task time is: " + minTaskTime);
						var diff = minTaskTime - now;
						if(diff > 0){
							util.debug("Waiting for next dequeue: " + diff / 1000);
							_this._dequeueTimeout = setTimeout(function(){
								_this._dequeueTrigger(minTask);
							}, diff);
						}
						else{
							util.debug("Past due time: " + diff / 1000);
							_this._dequeueTrigger(minTask);
						}
					}
				}
			});
		}
	});
}

CouchDatabase.prototype._dequeueTrigger = function(triggerID){
	var _this = this;
	_this._dequeueTimeout = null;

	var now = new Date().getTime();
	var deq = _this._db.doc("scheddesk.dequeue." + now);
	deq.body = {
		"_id" : "scheddesk.dequeue." + now,
		"timestamp" : now,
		"triggerID" : triggerID 
	};

	util.debug("Saving dequeue " + JSON.stringify(deq));
	deq.save(function(err, d){
		if(err){
			/* TODO */
			util.debug("Saving dequeue error " + JSON.stringify(err));
		}
		else{
			/* Nothing to do, wait for couch notification... */
			util.debug("Dequeue saved.");
		}
	});
}

exports.CouchDatabase = CouchDatabase;
