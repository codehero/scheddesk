/* Copyright (c) 2010 David Bender assigned to Benegon Enterprises LLC
 * See the file LICENSE for full license information.
 *
 * Sample main file.
 * */

/* This demo  does the following:
 * -creates a CouchDB backend database
 * -instantiates a server with said database
 *  -hooks up server to callbacks that dispatch scheduled commands
 * -instantiates an express web server */

var couch = require("./lib/couchdb.scheddesk");
var scheduler = require("./lib/scheduler.scheddesk");
var web = require("./lib/express.scheddesk");
var sys = require("sys");


/*  */
var express = require("express"),
    connect = require("connect");

var app = express.createServer();

app.configure('development', function(){
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
});

app.configure('production', function(){
   app.use(express.errorHandler()); 
});

// Configuration
app.configure(function(){
		app.set('views', __dirname + '/views');
		app.use(express.logger());
		app.use(express.bodyDecoder());
		app.use(express.methodOverride());
		app.use(app.router);
		app.use(express.staticProvider(__dirname + "/public"));
});

var couchConf = {
	"host":"localhost",
	"port":5984,
	"dbName":"schedule_db"
};

var schedConf = {
};

var cdb = new couch.CouchDatabase(couchConf);
var scheduler = new scheduler.Scheduler(schedConf);
var w = new web.WebServer(scheduler, app, "/sd");

/* When database loaded, intialize scheduler. */
cdb.addListener("init", function(err, data){
	if(err){
		sys.debug(JSON.stringify(err));
		return;
	}

	scheduler.init(cdb);
});

scheduler.addListener("init", function(){
	w.init();
});

scheduler.addListener("dispatch", function(task, completeCB){
	sys.debug("Executed task " + task.routineData.name + " " + task.routineID);
	/* Fake job execution, complete in 1 second. */
	setTimeout(function(){
		completeCB({"successEvent":"Completed."});
	}, 5000);
});

scheduler.addListener("update", function(){
	/* Not really reacting to updates, but nice to debug print. */
});



app.listen(8000);
