/* Copyright (c) 2010 David Bender assigned to Benegon Enterprises LLC
 * See the file LICENSE for full license information.
 *
 * RESTful interface.
 * */

/* This class takes as input a server instance and maps
 * REST functionality to it. */
var express = require("express"),
		connect = require("connect");

require("./dep/date");

function WebServer(sched, app, urlPrefix){
	this._sched = sched;
	this._prefix = urlPrefix;

	var w = this;
	w._app = app;

	/* When Scheduler loads enable full REST functionality. */
	w._sched.addListener("init", function(err, data){
		w.init();
	});


	return this;
}

WebServer.prototype.sendJSON = function(res, err, data){
	if(err){
		res.send(err.message, 501);
		return;
	}

	res.send(data, 200);
};

WebServer.prototype.creationResponse = function(res, err, data, loc){
	if(err){
		res.send(err.message, 501);
		return;
	}

	res.header("Location", loc);
	res.send(data, 201);
};

WebServer.prototype.init = function(){
	/* REST routes. */
	var w = this;

	var app = w._app;

	/* Do routes. shorten prefix name. */
	var p = this._prefix;


	/* URLS */
	var reportURL = p + "/report";
	var schedURL = p + "/sched";
	var actionURL = p + "/command";
	var adHocURL = schedURL + "/adHoc";
	var routineURL = schedURL + "/r";

	/* Configuration. */

	/* Create new routine. */
	app.post(routineURL, function(req, res){
		/* Rely on bodyDecoder() to parse json. */
		if(req.header("Content-Type") != "application/json"){
			res.send(415);
			return;
		}
		var routine = req.body;

		w._sched.addRoutine(null, routine, function(err, data){
			w.creationResponse(res, err, data, reportURL + "/r/" + data.rootID);
		});
	});

	/* Refresh the database from the web. */
	app.post(actionURL + "/refresh", function(req, res){
		var ret = w._sched.initRefresh();

		res.send(JSON.stringify(ret), 200);
	});

	/* Operational. */

	/* Create new routine. */
	app.post(routineURL, function(req, res){
		/* Rely on bodyDecoder() to parse json. */
		if(req.header("Content-Type") != "application/json"){
			res.send(415);
			return;
		}
		var routine = req.body;

		w._sched.addRoutine(null, routine, function(err, data){
			w.creationResponse(res, err, data, reportURL + "/r/" + data.rootID);
		});
	});

	/* Make adhoc change. */
	app.post(routineURL + "/:routineID/:taskTime/adhoc", function(req, res){
		/* Rely on bodyDecoder() to parse json. */
		if(req.header("Content-Type") != "application/json"){
			res.send(415);
			return;
		}
		var adHoc = req.body;

		var routineID = req.param("routineID");
		var taskTime = req.param("taskTime");

		w._sched.adHocAdjustment(routineID, taskTime, adHoc, function(err, data){
			w.creationResponse(res, err, data, "FIXME");
		});
	});


	/* Delete adhoc change. */
	app.del(adHocURL + "/:adHocID", function(req, res){
		var id = req.param("adHocID");

		w._sched.removeAdHoc(adHocID, function(err, data){
			w.sendJSON(res, err, data);
		});
	});


	/* Reporting. */

	/* Return routine list. */
	app.get(reportURL + "/schedule", function(req, res){
		w._sched.getDB().getSchedule(function(err, data){
			w.sendJSON(res, err, data);
		});
	});

	/* Return adhoc list. */
	app.get(reportURL + "/adhoc", function(req, res){
		w._sched.getDB().getAdHocs(function(err, data){
			w.sendJSON(res, err, data);
		});
	});

	/* Return routine data. */
	app.get(reportURL + "/r/:rootID", function(req, res){
		var rootID = req.param("rootID");
		w._sched.getDB().getRoutine(rootID, function(err, data){
			w.sendJSON(res, err, data);
		});
	});

	/* Return waiting tasks. */
	app.get(reportURL + "/waiting", function(req, res){
		w._sched.listWaiting(function(err, data){
			w.sendJSON(res, err, data);
		});
	});

	/* Return pending tasks. */
	app.get(reportURL + "/pending", function(req, res){
		w._sched.listPending(function(err, data){
			w.sendJSON(res, err, data);
		});
	});

	/* Return date range report on specified type.
	 * Start date is in seconds since Epoch.
	 * End date is in seconds since Epoch. */
	app.get(reportURL + "/:type/:startDate/:endDate", function(req, res){
		/* Parse date strings. */
		var t = req.param("type");
		var s = parseInt(req.param("startDate"), 10);
		var e = parseInt(req.param("endDate"), 10);

		if(isNaN(s) || isNaN(e)){
			res.send("Unparseable date specification", 400);
			return;
		}

		if(e < s){
			res.send("Invalid range specification", 400);
			return;
		}

		if(t == "cal"){
			w._sched.getCalendar(s, e, function(err, data){
				w.sendJSON(res, err, data);
			});
		}
		else if(t == "events"){
			w._sched.getDB().listEvents(s, e, function(err, data){
				w.sendJSON(res, err, data);
			});
		}
	});
};

exports.WebServer = WebServer;
