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


	/* Operational. */

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

	/* Return date range report on specified type. */
	app.get(reportURL + "/:type/:startDate/:endDate", function(req, res){
		/* Parse date strings. */
		var t = Date.parse(req.param("type"));
		var s = Date.parse(req.param("startDate"));
		var e = Date.parse(req.param("endDate"));

		if(s == null || e == null){
			res.send("Unparseable date specification", 400);
			return;
		}

		if(e < s){
			res.send("Invalid range specification", 400);
			return;
		}

		s = Math.round(s.getTime() / 1000);
		e = Math.round(e.getTime() / 1000);

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
