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
var child_process = require('child_process');

var time = require("time");

function calculateExecutionTime(routine, now){
	var ret = null;

	/* Calculate next execution time. */
	switch(routine.period.units){
		case "seconds":
			/* First execution is timed to start at beginning of interval.
			 * Going to execute the nth iteration. */
			var diff = now - routine.interval[0];
			var ms = routine.period.magnitude  * 1000;
			var t = Math.ceil(diff / ms);
			ret = t * ms + routine.interval[0];
			break;

		case "days":
			var d = new time.Date();
			d.setTimezone("America/New_York");
			var rt = routine.period.time;
			/* Can calculate in one of two ways:
			 * -Use local wall clock time
			 * -Offset the day by an absolute number of hh:mm:ss */
			if(rt.isClock){

				var dn = new time.Date(d.getFullYear(), d.getMonth(), d.getDate(),
					rt.value[2], rt.value[1], rt.value[0]);

				ret = dn.getTime();
			}
			else{
				var dn = new time.Date(d.getFullYear(), d.getMonth(), d.getDate());
				dn = dn.getTime();
				dn += (3600 * rt.value[2] + 60 * rt.value[1] + rt.value[0]) * 1000;
				ret = dn;
			}

			/* If we already missed the date, forget and it plan for the next one. */
			if(ret < now){
				util.debug("PUSHING FORWARD");
				ret += 86400000;
			}
			break;

		case "months":
			/* TODO */
			break;

		case "years":
			/* TODO */
			break;

		default:
			/* BUG */
			throw new Error("BUG UNKNOWN TIME UNIT " + r.period.units);
	}

	return ret;
}


/* This class is a CouchDB backend. */
var CouchDatabase = function(conf, seq){
	EventEmitter.call(this);

	/* Install the db. */

	this._conf = conf;
	this._couchClient = couchdb.srv(conf.host, conf.port);
	
	this._couchClient.auth = conf.user +":"+ conf.password;

	this._db = this._couchClient.db(conf.dbName);

	this._routines = {};
	this._schedule = {};
	this._triggers = {};
	this._loaded = false;
	this._cancelInit = false;
	this._executingTrigger = null;
	this._dequeueTimeout = null;
	this._dequeuingCount = 0;

	/* Delete state files. */
	try{
		fs.unlinkSync(path.join(this._conf.stateDir, "schedule.json"));
		fs.unlinkSync(path.join(this._conf.stateDir, "triggers.json"));
	}
	catch(e){
	}

	/* Convenient locals. */
	var _this = this;
	var cdb = this._db;

	cdb.info(function(err, data){
		if(err){
			/* TODO */
			_this.emit("init", err);
		}
		else{
			var opts = {
				"since":data.update_seq,
				"filter":"SchedDeskApp/changesFilter",
				"feed":"continuous",
				"include_docs":true
			};

			cdb.changes(opts, function(err, changeStream){
				changeStream.on("change", function(change){
					_this._onChange(change);
				});
			});


			_this._beginInit();
		}
	});

	return this;
}
inherits(CouchDatabase, EventEmitter);

CouchDatabase.prototype._beginInit = function(){
	var _this = this;
	var cdb = this._db;

	_this._cancelInit = false;

	util.debug("_beginInit");

	/* Initiate request for active routines on schedule. */
	var ddoc = cdb.ddoc("SchedDeskApp");
	var view = ddoc.view("Schedule");
	view.query({
			"startkey" : 1,
			"include_docs" : true,
			"reduce" : false
		},
		function(err, scheduleRes){
			if(err){
				/* TODO */
				util.debug("ERROR1 " + JSON.stringify(err));
				return;
			}

			/* Retry if some update occurred. */
			if(_this._cancelInit){
				_this._beginInit();
				return;
			}

			/* Ignore error state when finding tasks to queue.. */
			var preMask = 0x1 | 0x2 | 0x8;
			ddoc.view("State").list("StateQuery",
				{
					"op" : "eq",
					"maskValue" : "0x1",
					"preMask" : preMask.toString(16),
					"reduce" : true,
					"group" : true
				},
				function(err, stateQuery){
					if(err){
						/* TODO */
						util.debug("ERROR2 " + JSON.stringify(err));
						return;
					}

					/* Retry if some update occurred. */
					if(_this._cancelInit){
						_this._beginInit();
						return;
					}

					function populateSchedule(){
						var sched = {};
						util.debug("Schedule: " + JSON.stringify(scheduleRes));
						for(var i = 0; i < scheduleRes.rows.length; ++i)
							sched[scheduleRes.rows[i].doc._id] = scheduleRes.rows[i].doc;
						_this._schedule = sched;
						_this._loaded = true;

						/* Save schedule to file. */
						var filename = path.join(_this._conf.stateDir, "schedule.json");
						fs.writeFile(filename, JSON.stringify(_this._schedule));
					}

					util.debug("STATE QUERY: " + JSON.stringify(stateQuery));

					/* Retrieve active triggers. */
					var ids = [];
					for(var i = 0; i < stateQuery.length; ++i)
						ids.push(stateQuery[i].key);

					if(ids.length){
						_this._db.allDocs({"include_docs":true}, ids, function(err, mdocs){
							if(err){
								util.debug("ERROR3 " + JSON.stringify(err));
								/* TODO */
								return;
							}

							/* Retry if some update occurred. */
							if(_this._cancelInit){
								_this._beginInit();
								return;
							}

							/* Populate triggers directly, call update trigger function
							 * to write out state file. */
							for(var i = 0; i < mdocs.rows.length; ++i){
								_this._triggers[mdocs.rows[i].doc._id] =
									mdocs.rows[i].doc.scheddesk_trigger;
							}
							_this._updateTrigger(null, null);

							/* Populate Schedule. */
							populateSchedule();
							_this._performScheduling();
							_this._determineNextTrigger();

							_this.emit("init", null);
						});
					}
					else{
						_this._triggers = {}; 
						_this._updateTrigger(null, null);
						populateSchedule();
						_this._performScheduling();
						_this._determineNextTrigger();
					}
				}
			);
		}
	);
}

CouchDatabase.prototype._executeTrigger = function(triggerID, dequeueID){
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
	var trig = _this._triggers[triggerID];

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

	util.debug("Getting task definition " + _this._triggers[triggerID].taskDefinition);
	var taskDef = cdb.doc(trig.taskDefinition);
	taskDef.get(function(err, task){
		/* If we cannot get the */
		if(err){
			util.debug("Get Task Data " + JSON.stringify(err));
			if(err.error == "not_found"){
				_this._executingTrigger = null;
				_this._updateTrigger(triggerID);
			}
			else{
				/* Some comm error, retry.. */
				/* TODO */
			}
			return;
		}

		/* Execute according to task definition. */
		if(task.taskType == "child_process"){
			var params = task.params;
			var options = {
				"cwd": (trig.params && trig.params.cwd) || task.params.cwd,
				"env": (trig.params && trig.params.env) || task.params.env || process.env
			};
			options.env.TRIGGER_ID = triggerID;

			var args = (trig.params && trig.params.args) || task.params.args;
			var proc = child_process.spawn(task.params.command, args, options);
			util.debug("EXECUTING " + task.params.command);
			proc.on("exit", function(code){
				util.debug("Exited with code " + code);
				if(!task.taskType.filesTermination){
					var ts = new Date().getTime();

					/* TODO Attach success/error information. */
					if(!code){
						util.debug("Saving termination: " + JSON.stringify(term));

						var doc = cdb.doc("scheddesk.termination." + ts);
						doc.body = {
							"_id" : "scheddesk.termination." + ts,
							"timestamp" : ts,
							"triggerID" : triggerID,
							"dequeueID" : dequeueID
						};
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
							util.debug("Saved error report: ");
							if(err){
								/* TODO */
								util.debug("Saving termination error: " + JSON.stringify(err));
							}
							else{
								/* Save error files as attachments. */

								if(task.diagnosticFiles){
									var prefix = "curl --user "
										+ _this._conf.user+":"+ _this._conf.password
										+" -vX PUT http://"+ _this._conf.host +":"+ _this._conf.port
										+"/"+ _this._conf.dbName +"/"+ errID;

									util.debug(JSON.stringify(_this));
									util.debug(JSON.stringify(_this._conf));
									util.debug(prefix);

									function saveAttachment(counter, rev){
										if(counter == task.diagnosticFiles.length)
											return;

										/* Execute curl script to save file. */
										var diag = task.diagnosticFiles[counter];
										var filename = diag.path.split("/");
										filename = filename.length ?
											filename[filename.length - 1] : diag.path;
										var mime = diag.mime;
										var suffix = "/"+ filename +"?rev="+ rev
											+" -H \"Content-Type:"+ mime
											+"\" --data-binary @" + diag.filename;

										util.debug(suffix);
										child_process.exec(prefix + suffix, function(err, stdout, stderr){
											if(err){
												/* TODO Sa*/
												util.debug("Saving err attachment: " + JSON.stringify(err));
											}
											else{
												var ret = JSON.parse(stdout);
												saveAttachment(counter + 1, ret._rev);
											}
										});
									}
									saveAttachment(0, d._rev);
								}
							}
						});
					}
				}
			});
		}
		else {
			util.puts("Unknown task type!");
			_this._executingTrigger = null;
			_this._updateTrigger(triggerID);
		}
	});
}

CouchDatabase.prototype._determineNextTrigger = function(){
	util.debug("_determineNextTrigger");
	if(this._dequeuingCount || this._executingTrigger){
		util.debug("_dequeuingCount:" + this._dequeuingCount);
		util.debug("_executingTrigger:" + this._executingTrigger);
		return;
	}

	if(this._dequeueTimeout){
		util.debug("Clearing dequeue");
		clearTimeout(this._dequeueTimeout);
		this._dequeueTimeout = null;
	}

	var now = new Date().getTime();
	util.debug("NOW " + now);
	var target = null;
	var earliest = Infinity;
	for(var id in this._triggers){
		/* If we find a trigger that should have been executed in the past,
		 * create a dequeue entry for it in the DB. */
		var t = this._triggers[id];
		if(t.scheduledTime < now){
			target = id;
			break;
		}
		else{
			if(t.scheduledTime < earliest){
				target = id;
				earliest = t.scheduledTime;
			}
		}
	}

	/* If nothing to execute, return. */
	util.debug("GOT TARGET " + target);
	if(!target)
		return;

	/* Set up the closure to initiate dequeuing of this trigger. */
	var _this = this;
	var cb = function(){
		++_this._dequeuingCount;
		var now = new Date().getTime();
		var deq = _this._db.doc("scheddesk.dequeue." + now);
		deq.body = {
			"_id" : "scheddesk.dequeue." + now,
			"timestamp" : now,
			"triggerID" : target
		};

		util.debug("Saving dequeue " + JSON.stringify(deq));
		deq.save(function(err, d){
			if(err){
				/* TODO */
				util.debug("Saving dequeue error " + JSON.stringify(err));
			}
			else{
				/* Nothing to do, wait for couch notification... */
				_this.emit("dequeing", _this._triggers[target]);
			}
		});
	}

	if(this._triggers[target].scheduledTime < now){
		cb();
	}
	else{
		this.emit("scheduling", this._triggers[target]);
		var diff = this._triggers[target].scheduledTime - now;
		util.debug("Waiting for " + diff);
		this._dequeueTimeout = setTimeout(cb, diff);
	}
}

CouchDatabase.prototype._performScheduling = function(){
	var cdb = this._db;
	util.debug("Perform scheduling.");

	/* First check off routines that are already scheduled. */
	var checkoff = {};
	for(var id in this._triggers){
		var t = this._triggers[id];
		if("routineID" in t)
			checkoff[t.routineID] = true;
	}

	util.debug("Checked off:" +JSON.stringify(checkoff));

	/* Schedule the routines  */
	var count = 0;
	for(var routineID in this._schedule){
		if(routineID in checkoff)
			continue;

		util.debug("Routine:" + routineID);
		var r = this._schedule[routineID];
		var now = new Date().getTime();
		util.debug("CURRENT TIME IS " + now);

		util.debug("Routine Data: " + JSON.stringify(r));
		if(now > r.interval[1]){
			util.debug("Routine: Interval is no longer valid now: " + now + " " + r.interval[1]);
			/* TODO: Remove routine from schedule. */

			continue;
		}

		var trigger = {
			"_id" : "scheddesk.timedTrigger.",
			"scheddesk_trigger" : {
				"timestamp" : now,
				"taskDefinition" : r.taskID
			}
		};

		try{
			trigger.scheddesk_trigger.scheduledTime = calculateExecutionTime(r, now);
		}
		catch(e){
			util.debug(e.message);
			continue;
		}

		util.debug("SCHEDULED TIME IS " + trigger.scheddesk_trigger.scheduledTime);
		trigger._id += trigger.scheddesk_trigger.scheduledTime;
		if(trigger.scheddesk_trigger.scheduledTime > r.interval[1]){
			util.debug("Routine: Scheduled time exceeds interval.");
			/* TODO: Remove routine from schedule. */
			continue;
		}

		++count;
		trigger._id += "_" + count;

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
		});
	}
}

CouchDatabase.prototype._onChange = function(change){
	var _this = this;

	/* If not loaded, then we need to ignore schedule/queue results
	 * and retry the init. */
	if(!_this._loaded){
		_this._cancelInit = true;
		return;
	}

	util.debug("CHANGE " + change.id);

	var doc = change.doc;

	var parts = change.id.split(".");
	if(parts[0] == "scheddesk"){
		switch(parts[1]){
			case "routine":
				/* If id is not present in our list, then this is a new routine
				 * Otherwise must be change or deletion of existing routine. */
				if(parts[2] in _this.routines){
					if(change.deleted){
						_this.emit("deletedRoutine", parts[2]);
						/* TODO Remove any triggers based on this routine. */
					}
					else{
						_this.emit("changedRoutine", doc);

						/* TODO Modify the start time of matching waiting triggers. */
					}
				}
				else{
					_this.emit("createdRoutine", doc);
					/* Recalculate scheduling and determine next trigger. */
					_this._performScheduling();
					_this._determineNextTrigger();
				}
				break;

			case "taskDefinition":
				/* Nothing to report really, good to know I guess. */
				break;

			case "dequeue":
				util.debug("DEQUEUE TRIGGER " + change.doc.triggerID);
				--_this._dequeuingCount;
				/* Expect the trigger ID to be in the list. */
				if(change.doc.triggerID in _this._triggers){
					this.emit("dequeuedRequest", doc);
					/* Execute the matching trigger. */
					_this._executeTrigger(change.doc.triggerID, change.id);
				}
				else{
					/* BUG This is a bug. */
					util.debug("BUG X0");
				}
				break;

			case "termination":

				/* If we get a terminated updated, but its not in the list
				 * then its effectively a NO-OP since scheddesk_terminated
				 * cannot be updated. */
				if(_this._executingTrigger){
					if(doc.triggerID in _this._triggers){
						_this.emit("terminatedRequest", data);
						/* Remove from _triggers. */

						_this._updateTrigger(doc.triggerID);
						_this._executingTrigger = null;

						/* If this is a retry trigger then get original trigger. */
						if("scheddesk_retry" in doc){
							_this._db.getDoc(doc.scheddesk_retry.triggerID, function(err, data){
								if(err){
									/* TODO */
								}
								else{

									_this._updateTrigger(data._id, data.scheddesk_trigger);

									_this._performScheduling();
									_this._determineNextTrigger();
								}
							});
						}
						else{
							/* Determine next trigger to execute. */
							_this._performScheduling();
							_this._determineNextTrigger();
						}
					}
					else{
						/* BUG */
						util.debug("BUG X1");
					}
				}
				else{
					/* BUG */
					util.debug("BUG X2");
				}

				break;

			default:
				break;
		}
	}

	if("scheddesk_trigger" in doc){
		/* If our trigger is in the list then NO-OP because
		 * the trigger field cannot be updated.
		 * If the trigger is NOT in the list, then we have to
		 * check whether its already completed. */

		/* Retrieve triggerID's state from the DB. */
		var ddoc = _this._db.ddoc("SchedDeskApp");
		var view = ddoc.view("State");
		view.query(
			{
				"startkey": change.id,
				"endkey": change.id + "\uFFF0",
				"reduce":true
			},
			function(err, res){
				if(err){
					/* TODO */
				}
				else{
					/* Must be exactly one result. */
					if(res.rows.length == 1){
						var r = res.rows[0];
						/* If just enqueued then trigger enqueued request. */
						if(r.value.mask == 0x1 || r.value.mask == 0x5){
							_this.emit("enqueuedRequest", r);
							/* Add to triggers list. */
							if(!(change.id in _this._triggers)){
								_this._updateTrigger(change.id, doc.scheddesk_trigger);
								_this._determineNextTrigger();
							}
							else{
								/* BUG */
								util.debug("BUG X3");
							}
						}
					}
					else{
						/* BUG Invalid result. */
						util.debug("BUG X4");
					}
				}
			}
		);
	}

	if("scheddesk_err_report" in doc){
		if(_this._executingTrigger){
			if(doc.scheddesk_err_report.triggerID in _this._triggers){
				_this.emit("terminatedRequest", doc.scheddesk_err_report.triggerID);
				/* Remove from _triggers. */
				_this._updateTrigger(doc.scheddesk_err_report.triggerID);
				_this._executingTrigger = null;
			}
			else{
				/* BUG */
				util.debug("BUG Y1");
			}

			/* Determine next trigger to execute. */
			_this._performScheduling();
			_this._determineNextTrigger();
		}
		else{
			/* BUG */
			util.debug("BUG Y2");
		}
	}

}

CouchDatabase.prototype._updateTrigger = function(triggerID, triggerData){
	if(triggerID){
		if(!triggerData)
			delete this._triggers[triggerID];
		else
			this._triggers[triggerID] = triggerData;
	}

	/* Save trigger state to file. */
	var filename = path.join(this._conf.stateDir, "triggers.json");
	fs.writeFile(filename, JSON.stringify(this._triggers));
}
exports.CouchDatabase = CouchDatabase;
