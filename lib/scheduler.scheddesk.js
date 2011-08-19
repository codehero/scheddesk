/* Copyright (c) 2010 David Bender assigned to Benegon Enterprises LLC
 * See the file LICENSE for full license information.
 *
 * Core Scheduler.
 * */

var sys = require("sys");
var inherits = require("sys").inherits;
var EventEmitter = require("events").EventEmitter;
require("./dep/date");

/* The server class will take as input
 * -the database
 * -callback functions
 * and export functions.  */

/* conf expects the following cbs defined:
 * -dispatch(taskData, adjustment, cb)
 *  schedData : Explains the task data
 *  adjustment : Time adjustment
 *  cb(err, cb) : function to call when dispatch actually begins
 *  -if err then could not initiate dispatch
 *  -pass it a callback which will receive the dispatch id
 *
 * Server emits the following events:
 *
 * "init" : Server calls when initialization succeeds or fails
 *    scheduler has generated initial schedule on successful initialization
 * "dispatch" : Server calls when it is time to dispatch a task
 * "update" : changes to one or more assigned task execution times
 *
 * Notes:
 * -No "dispatch" or "update" events precede the "init" event.
 *
 * */

function Scheduler(conf){
	EventEmitter.call(this);
	this._conf = conf;
	this._state = "Uninitialized";
	this._refresh = true;

	this._executing = false;

	return this;
}
inherits(Scheduler, EventEmitter); 

Scheduler.prototype.init = function(db){
	var sched = this;
	sched._db = db;

	if(this._state == "Configuration")
		return;
	this._state = "Configuration";

	/* Retrieve schedule definition and adhoc changes. */
	sched._db.getSchedule(function(err, schedule){
		if(err){
			sched._state = "Failed";
			throw new Error("Server init error:" + err.message);
		}

		sched._waiting = {};
		sched._pending = {};

		/* Generate future tasks. */
		sched.schedule = schedule;
		for(routineID in sched.schedule){
			var routine = sched.schedule[routineID];
			sched._waiting[routineID] = {
				"routineID" : routineID,
				"routineData" : routine
			};
		}

		sched._db.getAdHocs(function(err, list){
			sys.debug("Toggling refresh false");
			sched._refresh = false;

			if(err){
				sched._state = "Failed";
				throw new Error("Server init error:" + err.message);
			}

			/* Apply each adHoc. */
			for(var i = 0; i < list.length; ++i){
				/* FIXME */
			}
			sched._state = "Operation";

			/* Schedule tasks for later execution. */
			for(routineID in sched._waiting)
				sched._schedule(routineID);

			sched.emit("init");
		});
	});

	return this;
}

/* Utility functions. */
Scheduler.prototype.getDB = function(){
	return this._db;
}

/* Refresh the DB when changes are made to the underlying DB. */
Scheduler.prototype.initRefresh = function(){
	var cleared = 0;
	if(!this._refresh){
		sys.debug("Initiating refresh");
		this._refresh = true;

		/* Kill all the pending timers. No more tasks may execute. */
		var t = this._waiting;
		for(x in t){
			clearTimeout(t[x].timeoutID);
			++cleared;
		}

		/* Clear waiting and pending tasks. */
		this._waiting = {};

		if(!this._executing){
			this.init(this._db);
		}
	}

	return {"cleared":cleared};
}


Scheduler.prototype.now = function(){
	return Math.round(new Date().getTime() / 1000);
}

/* Configuration functions. */

/* Add a routine to the schedule. Reactivates a dead routine chain.
 * @param rootID if defined, updating that routine chain. If undefined, new routine
 e @param routine Routine definition.
 * @param cb Called on resolution, data is updated routine, cb(err, routine).
 * */
Scheduler.prototype.addRoutine = function(rootID, routine, cb){
	if(this._state != "Operation")
		throw new Error("Scheduler in invalid state!");

	/* Validate routine data structure.
	 * If the user wants to deactivate the routine,
	 * he should use deactivate() */
	if(!routine.timing)
		throw new Error("Routine must define timing!");

	/* FIXME Currently unable to modify existing routines. */
	if(rootID)
		throw new Error("Routine update unimplemented!");

	/* If no startTime defined, use Now. */
	if(!routine.timing.startTime)
		routine.timing.startTime = this.now();

	/* Adding new routine. */

	/* Attempt to calculate next execution. */
	var next = this._calcTaskTime(routine);
	if(isNaN(next))
		throw new Error("Invalid routine timing specification!");

	/* New routines cannot define predecessors. */
	if(routine.predecessor)
		throw new Error("Invalid field in routine!");

	/* Add routine to database. */
	var sched = this;
	this._db.createRoutine(routine, function(err, data){
		/* If err then just forward to caller.
		 * Nothing changed, so nothing to cleanup.*/
		if(err){
			cb(err, null);
			return;
		}

		/* No adhocs exist for this routine so just directly add it. */
		var routineID = data.rootID;
		sched._waiting[routineID] = {
			"routineID" : routineID,
			"routineData" : data
		};
		sched._schedule(routineID);

		cb(null, data);
	});
}

/* Deactivate routine chain.
 * Clears waiting tasks, but still records executing ones.
 * @param cb Called back for the following reasons:
 * -successful initiation of deactivation, with count of pending tasks
 * -if count is nonzero, one more call will indicate ALL pending tasks complete. */
Scheduler.prototype.deactivate = function(rootID, cb){
	if(this._state != "Operation")
		throw new Error("Scheduler in invalid state!");

	/* Routine update is unimplemented */
	throw new Error("Routine deactivation unimplemented!");
}

/* Sets beginning of Time window. */
Scheduler.prototype.adjustWindowStart = function(newTime, cb){
	if(this._state != "Operation")
		throw new Error("Scheduler in invalid state!");
	throw new Error("Unimplemented!");
}

/* Operation functions. */

/* Submit adHoc adjustment
 * @param routineID Identifies the routine.
 * @param taskTime Identities particular task
 * @param adHoc parameters; If not defined makes task execute 'now'
 *  If defined, then if adHoc._id defined updates adHoc.
 * */
Scheduler.prototype.adHocAdjustment = function(routineID, taskTime, adHoc, cb){
	if(this._state != "Operation")
		throw new Error("Scheduler in invalid state!");
	throw new Error("Unimplemented!");
}

/* Remove previously submitted ad hoc adjustments
 * If no adHoc specified executes as a 'now' adHoc
 * If adHoc defined, then if adHoc._id defined updates previous entry. */
Scheduler.prototype.removeAdHoc = function(adHocID, cb){
	if(this._state != "Operation")
		throw new Error("Scheduler in invalid state!");
	throw new Error("Unimplemented!");
}

/* Request scheduler shutdown */
Scheduler.prototype.shutdown = function(cb){
	/* Shutdown works regardless of state. */

	/* FIXME Terminate pending tasks...record as failure, since
	 * system shutdown before any results from the tasks were received. */
}

/* Reporting functions. */

/* List all Tasks waiting for execution. */
Scheduler.prototype.listWaiting = function(cb){
	/* Return empty list if refreshing. */
	if(this._refresh)
		return [];

	if(this._state != "Operation")
		throw new Error("Scheduler in invalid state!");

	var ret = [];
	for(var routineID in this._waiting){
		/* FIXME maybe just hold references, not all data? */
		ret.push(this._waiting[routineID]);
	}
	cb(null, ret);
}

/* List all Tasks currently executing. */
Scheduler.prototype.listPending = function(cb){
	if(this._state != "Operation")
		throw new Error("Scheduler in invalid state!");

	var ret = [];
	for(var routineID in this._pending){
		/* FIXME maybe just hold references, not all data? */
		ret.push(this._pending[routineID]);
	}
	cb(null, ret);
}

/* Report all task executions (includes adhoc adjustments).
 * @param startTime Time calendar begins.
 * @param endTiem Time calendar ends.
 * @param cb callback of form (err, list), where each element in list is
 * [execTime, routineID, taskTime], in no particular order. */
Scheduler.prototype.getCalendar = function(startTime, endTime, cb){
	if(this._state != "Operation")
		throw new Error("Scheduler in invalid state!");
	throw new Error("Unimplemented!");
}

/* Internal functions. */

/* Apply ad hoc adjustment. */
Scheduler.prototype._applyAdHoc = function(adHoc){
	throw new Error("Unimplemented!");
}

Scheduler.prototype._schedule = function(routineID){
	var t = this._waiting[routineID];
	var sched = this;

	/* Cancel pending timeout. */
	if(t.timeoutID){
		clearTimeout(t.timeoutID);
		delete t.timeoutID;
	}

	/* FIXME handle adhoc changes! */

	/* Calculate taskTime */
	t.taskTime = sched._calcTaskTime(t.routineData);
	if(isNaN(t.taskTime))
		throw new Error("Invalid routine timing specification!");

	var diff = t.taskTime - sched.now();
	sys.debug("Setting time out for " + t.taskTime + " in " + diff);

	t.timeoutID = setTimeout(function(){
		delete t.timeoutID;

		/* Move task to pending. */
		sched._pending[routineID] = t;
		delete sched._waiting[routineID];

		if(sched._refresh){
			this.init(this._db);
		}
		else{
			sched._executing = true;

			/* Record dispatch event. */
			var now = sched.now();
			sched._db.recTaskEvent(routineID, t.taskTime, {"dispatchTime":now},
				function(err, d){
					/* Emit "dispatch" event, with relevant taskdata
					 * and completion closure. */
					sched.emit("dispatch", t, function(termData){
						sched._terminate(t, termData, function(err, d){
							/* FIXME do I need to do anything here?? */
						});
					});
				}
			);
		}
	}, (t.taskTime - sched.now()) * 1000);
}

/* Calculate next task time. */
Scheduler.prototype._calcTaskTime = function(routine){
	/* If deactivated then nothing to do. */
	if(!routine.timing)
		return null;

	/* Otherwise calculate exact second when task SHOULD execute. */
	var now = this.now();

	/* Monthly is the only non-numeric period. */
	if(routine.timing.period == "monthly"){
		throw new Error("Monthly timing unimplemented!");
	}
	else {
		/* Period is defined in seconds.
		 * endpoint is always "begin" */
		var p = routine.timing.period;
		var curOff = (now - routine.timing.startTime);
		curOff %= p;
		return now + p - curOff;
	}
}

/* Signal executing task termination. */
Scheduler.prototype._terminate = function(task, data, cb){

	/* Routine is finished. */
	this._executing = false;

	/* Sanity check that task is pending. */
	if(!(task.routineID in this._pending))
		throw new Error("Task is not in pending list!");

	/* Check if task completed. Make sure completion data is up to spec.*/
	if(data.successEvent){
		if(!data.successTime)
			data.successTime = this.now();
	}
	else if(data.userAction){
		/* FIXME */
	}
	else if(data.errorEvent){
		if(!data.errorTime)
			data.errorTime = this.now();
	}
	else{
		/* No indication of success/failure. Report error! */
		throw new Error("Invalid completion data!");
	}

	/* FIXME combine relevant adHoc data with data parameter! */
	/* FIXME Delete adHoc reference. */

	/* Record dispatch event. just report db error if it occurs. */
	this._db.recTaskEvent(task.routineID, task.taskTime, data, function(err, data){
		cb(err);
	});

	/* Move task to waiting. */
	delete task.taskTime;
	delete this._pending[task.routineID];

	/* If refreshing then reinitialize. */
	if(this._refresh){
		this.init(this._db);
	}
	else {
		this._waiting[task.routineID] = task;

		/* Reschedule the task. */
		this._schedule(task.routineID);
	}
}

exports.Scheduler = Scheduler;
