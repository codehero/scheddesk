/* Copyright (c) 2010 David Bender assigned to Benegon Enterprises LLC
 * See the file LICENSE for full license information.
 *
 * Database Interface
 * */

var inherits = require("sys").inherits;
var EventEmitter = require("events").EventEmitter;

/* Parent class. Note that implementing dbs should emit "init" event
 * when they are ready to service requests. */
function Database(){
	return this;
}
inherits(Database, EventEmitter); 

Database.prototype.Error = function(message){
	this.message = message;
	return this;
}

/* Configuration; If Scheduler is active, only IT should call these. */

/* Create new routine. */
Database.prototype.createRoutine = function(routine, cb){
	throw new Error("Unimplemented!");
}

/* Append routine modification to existing routine.
 * Note that appending routines with frequency 0 deactivates the routine! */
Database.prototype.appendRoutine = function(rootID, routine, cb){
	throw new Error("Unimplemented!");
}

/* Add/Modify adhoc execution. */
Database.prototype.adHocAdjust = function(adHocData, cb){
	throw new Error("Unimplemented!");
}

/* Delete ad hoc adjustment from database. */
Database.prototype.deleteAdHoc = function(adHocID, cb){
	throw new Error("Unimplemented!");
}

/* Record task event (dispatch, terminate, cancel, etd);
 * data defines how task execution ended. */
Database.prototype.recTaskEvent = function(routineID, taskTime, data, cb){
	throw new Error("Unimplemented!");
}


/* Reporting functions. */

/* Get schedule definition.
 * Returns a map of routineIDs to routines. */
Database.prototype.getSchedule = function(cb){
	throw new Error("Unimplemented!");
}

/* Get routine data
 * @param rootID Identifies routine root
 * @param revID If null, then latest revision; if not then exact revision.
 * Returns Array of routines, listed in ascending chronological order. */
Database.prototype.getRoutine = function(rootID, cb){
	throw new Error("Unimplemented!");
}

/* Get list of AdHoc adjustments. */
Database.prototype.getAdHocs = function(cb){
	throw new Error("Unimplemented!");
}

/* Get listing of events given start and end date.
 * @param cb cb(err, list), where list has elems of
 * [timestamp, routineID, taskTime, type]
 * */
Database.prototype.listEvents = function(startDate, endDate, cb){
	throw new Error("Unimplemented!");
}

/* Get listing of events given start and end date.
 * @param cb cb(err, list), where list has elems of
 * [timestamp, routineID, taskTime, type]
 * */
Database.prototype.getChecklist = function(routineID, startDate, cb){
	throw new Error("Unimplemented!");
}

/* Get missing tasks in the checklist.
 * @param startDate beginning of search range
 * @param endDate end of search range
 * @param cb cb(err, list), where list has elems of
 * [timestamp, routineID, taskTime, type]
 * */
Database.prototype.listHoles = function(startDate, endDate, cb){
	throw new Error("Unimplemented!");
}

exports.Database = Database;
