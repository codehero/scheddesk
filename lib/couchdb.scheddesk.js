/* Copyright (c) 2010 David Bender assigned to Benegon Enterprises LLC
 * See the file LICENSE for full license information.
 *
 * CouchDB Database Backend
 * */

var couchdb = require("couchdb");
var sys = require("sys");
var inherits = require("sys").inherits;
var EventEmitter = require("events").EventEmitter;
var db = require("./db.scheddesk");
var child_process = require('child_process');

var time = require("time");


/* This class is a CouchDB backend. */
var CouchDatabase = function(conf, seq){
	db.Database.call(this);

	/* Install the db. */

	this._conf = conf;
	this._couchClient = couchdb.createClient(conf.port, conf.hostname, conf.user, conf.password);
	this._db = this._couchClient.db(conf.dbName);

	this._routines = {};
	this._schedule = {};
	this._triggers = {};
	this._loaded = false;
	this._cancelInit = false;
	this._executingTrigger = null;
	this._dequeueTimeout = null;
	this._dequeuingCount = 0;

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
				"include_docs":true
			};
			var stream = cdb.changesStream(opts);

			stream.addListener("data", function(change){
				/* If not loaded, then we need to ignore schedule/queue results
				 * and retry the init. */
				if(!_this._loaded){
					_this._cancelInit = true;
					return;
				}

				sys.debug("CHANGE " + change.id);

				var doc = change.doc;

				var parts = change.id.split(".");
				if(parts[0] == "scheddesk"){
					switch(parts[1]){
						case "routine":
							/* If id is not present in our list, then this is a new routine
							 * Otherwise must be change or deletion of existing routine. */
							if(parts[2] in _this.routines){
								if(change.deleted){
									this.emit("deletedRoutine", parts[2]);
									/* TODO Remove any triggers based on this routine. */
								}
								else{
									this.emit("changedRoutine", doc);

									/* TODO Modify the start time of matching waiting triggers. */
								}
							}
							else{
								this.emit("createdRoutine", doc);
								/* Recalculate scheduling and determine next trigger. */
								_this._performScheduling();
								_this._determineNextTrigger();
							}
							break;

						case "taskDefinition":
							/* Nothing to report really, good to know I guess. */
							break;

						case "dequeue":
							sys.debug("DEQUEUE TRIGGER " + change.doc.triggerID);
							--this._dequeuingCount;
							/* Expect the trigger ID to be in the list. */
							if(change.doc.triggerID in _this._triggers){
								this.emit("dequeuedRequest", doc);
								/* Execute the matching trigger. */
								_this._executeTrigger(change.doc.triggerID);
							}
							else{
								/* BUG This is a bug. */
								sys.debug("BUG X0");
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
									delete _this._triggers[doc.triggerID];
									_this._executingTrigger = null;
								}
								else{
									/* BUG */
									sys.debug("BUG X1");
								}

								/* Determine next trigger to execute. */
								_this._performScheduling();
								_this._determineNextTrigger();
							}
							else{
								/* BUG */
								sys.debug("BUG X2");
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
					_this._db.view("SchedDeskApp", "State",
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
									if(r.value.mask == 0x1){
										_this.emit("enqueuedRequest", data);
										/* Add to triggers list. */
										if(!(change.id in _this._triggers)){
											_this._triggers[change.id] = doc.scheddesk_trigger;
											_this._determineNextTrigger();
										}
										else{
											/* BUG */
								sys.debug("BUG X3");
										}
									}
								}
								else{
									/* BUG Invalid result. */
								sys.debug("BUG X4");
								}
							}
						}
					);
				}
			});

			_this._beginInit();
		}
	});

	return this;
}
inherits(CouchDatabase, db.Database); 

CouchDatabase.prototype._beginInit = function(){
	var _this = this;
	var cdb = this._db;

	_this._cancelInit = false;

	/* Initiate request for active routines on schedule. */
	cdb.view("SchedDeskApp", "Schedule",
		{
			"startkey" : 1,
			"include_docs" : true
		},
		function(err, scheduleRes){
			if(err){
				/* TODO */
				return;
			}

			/* Retry if some update occurred. */
			if(_this._cancelInit){
				_this.beginInit();
				return;
			}

			/* Initiate request for queue. */
			cdb.list("SchedDeskApp", "StateQuery", "State",
				{
					"op" : "eq",
					"maskValue" : 0x1,
					"group" : true
				},
				function(err, res){
					if(err){
						/* TODO */
						return;
					}

					/* Retry if some update occurred. */
					if(_this._cancelInit){
						_this.beginInit();
						return;
					}

					function populateSchedule(){
						var sched = {};
						sys.debug("Schedule: " + JSON.stringify(scheduleRes));
						for(var i = 0; i < scheduleRes.rows.length; ++i)
							sched[scheduleRes.rows[i].doc._id] = scheduleRes.rows[i].doc;
						_this._schedule = sched;
						_this._loaded = true;

						sys.debug("Schedule: " + JSON.stringify(_this._schedule));
					}

					/* Retrieve active triggers. */
					var ids = [];
					for(var i = 0; i < res.length; ++i)
						ids.push(res[i]._id);
					if(ids.length){
						_this._db.getMultipleDocs(ids, function(err, res){
							if(err){
								/* TODO */
								return;
							}

							/* Retry if some update occurred. */
							if(_this._cancelInit){
								_this.beginInit();
								return;
							}

							/* Populate triggers. */
							for(var i = 0; i < res.rows.length; ++i){
								_this._triggers[res.rows[i].doc._id] =
									res.rows[i].doc.scheddesk_trigger;
							}

							/* Populate Schedule. */
							populateSchedule();
							_this._performScheduling();
							_this._determineNextTrigger();

							_this.emit("init", null);
						});
					}
					else{
						_this._triggers = {}; 
						populateSchedule();
						_this._performScheduling();
						_this._determineNextTrigger();
					}
				}
			);
		}
	);
}

CouchDatabase.prototype._executeTrigger = function(triggerID){
	sys.debug("_executeTrigger " + this._executingTrigger);
	if(this._executingTrigger){
		/* BUG */
		sys.debug("BUG X4");
		return;
	}
	this._executingTrigger = triggerID;


	/* Get the task definiton. */
	var cdb = this._db;
	var _this = this;
	var trig = _this._triggers[triggerID];
	sys.debug("Getting task definition " + _this._triggers[triggerID].taskDefinition);
	cdb.getDoc(trig.taskDefinition, function(err, task){
		/* If we cannot get the */
		if(err){
			sys.debug("Get Task Data " + JSON.stringify(err));
			if(err.error == "not_found"){
				_this._executingTrigger = null;
				delete _this._triggers[triggerID];
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
				"env": (trig.params && trig.params.env) || task.params.env || {}
			};
			options.env.TRIGGER_ID = triggerID;

			var args = (trig.params && trig.params.args) || task.params.args;
			var proc = child_process.spawn(task.params.command, args, options);
			proc.on("exit", function(code){
				if(!task.taskType.filesTermination){
					var ts = new Date().getTime();
					var term = {
						"_id" : "scheddesk.termination." + ts,
						"timestamp" : ts,
						"triggerID" : triggerID
					};
					sys.debug("Saving termination: " + JSON.stringify(term));

					/* TODO Attach success/error information. */
					if(!code){
					}
					else{
						sys.debug("Exited with error : " + code);
					}

					cdb.saveDoc(term, function(err, d){
						sys.debug("Saved termination: ");
						if(err){
							/* TODO */
							sys.debug("Saving termination error: " + JSON.stringify(err));
						}
						else{
							/* TODO */
						}
					});
				}
			});
		}
		else {
			sys.puts("Unknown task type!");
			_this._executingTrigger = null;
			delete _this._triggers[triggerID];
		}
	});
}

CouchDatabase.prototype._determineNextTrigger = function(){
	sys.debug("_determineNextTrigger");
	if(this._dequeuingCount || this._executingTrigger)
		return;

	if(this._dequeueTimeout){
		clearTimeout(this._dequeueTimeout);
		this._dequeueTimeout = null;
	}

	var cdb = this._db;
	var _this = this;

	var now = new Date().getTime();
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

	/* If something to execute later, then set up closure for it. */
	if(target){
		sys.debug("GOT TARGET " + target);
		++this._dequeuingCount;
		var cb = function(){
			var deq = {
				"_id" : "scheddesk.dequeue." + now,
				"timestamp" : now,
				"triggerID" : target
			};

			sys.debug("Saving dequeue " + JSON.stringify(deq));
			cdb.saveDoc(deq, function(err, d){
				if(err){
					/* TODO */
					sys.debug("Saving dequeue error " + JSON.stringify(err));
				}
				else{
					/* Nothing to do, wait for couch notification... */
					_this.emit("dequeing", _this._triggers[target]);
				}
			});
		}

		if(_this._triggers[target].scheduledTime < now){
			cb();
		}
		else{
			_this.emit("scheduling", _this._triggers[target]);
			var diff = _this._triggers[target].scheduledTime - now;
			sys.debug("Waiting for " + diff);
			_this._dequeueTimeout = setTimeout(cb, diff);
		}
	}
}

CouchDatabase.prototype._performScheduling = function(){
	var cdb = this._db;
	sys.debug("Perform scheduling.");

	/* First check off routines that are already scheduled. */
	var checkoff = {};
	for(var id in this._triggers){
		var t = this._triggers[id];
		if("routineID" in t)
			checkoff[t.routineID] = true;
	}

	sys.debug("Checked off:" +JSON.stringify(checkoff));
	var now = new Date().getTime();
	sys.debug("CURRENT TIME IS " + now);

	/* Schedule the routines  */
	var count = 0;
	for(var routineID in this._schedule){
		if(!(routineID in checkoff)){
			sys.debug("Routine:" + routineID);
			var r = this._schedule[routineID];

			if(now > r.interval[1]){
				sys.debug("Routine: Interval is no longer valid now: " + now + " " + r.interval[1]);
				continue;
			}

			var trigger = {
				"_id" : "scheddesk.timedTrigger.",
				"scheddesk_trigger" : {
					"timestamp" : now,
					"taskDefinition" : r.taskID
				}
			};

			/* Calculate next execution time. */
			switch(r.period.units){
				case "seconds":
					/* First execution is timed to start at beginning of interval. */
					var diff = now - r.interval[0];
					var ms = r.period.magnitude  * 1000;
					var t = Math.ceil(diff / ms);
					trigger.scheddesk_trigger.scheduledTime = t * ms + r.interval[0];
					break;

				case "days":
					var d = new time.Date();
					d.setTimezone("America/New_York");
					if(r.period.time.isClock){
						var dn = new Date(d.getFullYear(), d.getMonth(), d.getDay(),
							r.period.time.value[2], r.period.time.value[1], r.period.time.value[0]);
						sys.debug("DATE IS " + dn);
						trigger.scheddesk_trigger.scheduledTime = dn.getTime();
					}
					else{
						var dn = new Date(d.getYear(), d.getMonth(), d.getDay());
						dn = dn.getTime();
						dn += (3600 * r.period.time.value[2] +
							60 * r.period.time.value[1] +
							r.period.time.value[0]) * 1000;
						trigger.scheddesk_trigger.scheduledTime = dn;
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
					sys.debug("BUG X5");
					break;
			}

			sys.debug("SCHEDULED TIME IS " + trigger.scheddesk_trigger.scheduledTime);
			trigger._id += trigger.scheddesk_trigger.scheduledTime;
			if(trigger.scheddesk_trigger.scheduledTime > r.interval[1]){
				sys.debug("Routine: Scheduled time exceeds interval.");
				continue;
			}
			++count;
			trigger._id += "_" + count;

			sys.debug("Saving trigger " + JSON.stringify(trigger));
			cdb.saveDoc(trigger, function(err, d){
				if(err){
					/* TODO */
					sys.debug("Saving trigger error " + JSON.stringify(err));
				}
				else{
					/* Nothing to do, wait for couch notification... */
				}
			});
		}
	}
}

CouchDatabase.prototype.clearAllRecords = function(){
	/* TODO */
	var _this = this;
	_this._db.view("SchedDeskApp", "State",
		{
			"reduce":false
		},
		function(err, res){
			if(err){
				/* TODO */
			}
			else{
				var delIds = [];
				for(var i = 0; i < res.rows.length; ++i){
					if(res.rows[i].value.mask > 1){
						/* TODO */
					}
				}
			}
		}
	);

}

exports.CouchDatabase = CouchDatabase;
