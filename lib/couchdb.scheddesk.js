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


var _Views = {
	"scheddesk":{
		"views":{

			"eventLog":{
				"map" : function(doc){
					var types = {
						"dispatchTime" : 0,
						"errorTime" : 1,
						"successTime" : 2
					};
					for(x in types){
						if(x in doc){
							emit([doc[x], doc.routineID, doc.taskTime, types[x]], {"_id" : doc._id});
							break;
						}
					}
				}
			},

			/* Record successfully terminated or user cleared tasks.
			 * List primarily by */
			"checklist":{
				"map" : function(doc){
					if(doc.successEvent || doc.userAction)
						emit([doc.routineID, doc.taskTime], {"_id" : doc._id});
				}
			},

			"schedule":{
				/* Only scheduling elements will have a timing defined. */
				"map" : function(doc){
					if(doc.timing){
						/* If no root defined, then doc is the root.
						 * It will be unique by having a 1 element array. */
						if(doc.rootID){
							emit(doc.rootID, [doc.predecessor, doc._id]);
						}
						else{
							emit(doc._id, [doc._id]);
						}
					}
				},

				/* This reduce function will build up the
				 * timeline of schedule changes. */
				"reduce" : function(key, values, rereduce){
					var idMap = {};
					var x = null;
					/* Map each chain to the first element in each subchain.
					 * The grand-daddy of them all goes to x. */
					for(var i = 0; i < values.length; ++i){
						if(values[i].length == 1)
							x = values[i][0];
						else
							idMap[values[i][0]] = values[i];
					}

					/* Start from the grandpa and add all in sequence. */
					var ret = [x];
					while(x in idMap){
						var arr = idMap[x];
						ret = ret.concat(arr.slice(1));
						x = arr[arr.length - 1];
					}
					return ret;
				}
			},

			"adHoc":{
				"map" : function(doc){
					if(doc.adHoc){
						var d = Math.round(new Date().getTime() / 1000);
						emit([doc.routineID, doc.taskTime], {"_id":doc._id, "addTime":d});
					}
				},

				/* If the user specifies multiple adhoc executions for the 
				 * same instance, only the earliest one submitted will win the reduce.
				 * -This is so earlier ad hocs can execute and then be deleted,
				 *  leaving these extra adhocs to execute later.
				 * User can always delete "duplicate" ad hocs...*/
				"reduce" : function(key, values, rereduce){
					var earliest = values[0].addTime;
					var idx = 0;
					for(var i = 0; i < values.length; ++i){
						if(values[i].addTime < earliest){
							earliest = values[i].addTime;
							idx = i;
						}
					}
					return values[idx];
				}
			}
		}
	}
};

/* This class is a CouchDB backend. */
var CouchDatabase = function(conf){
	db.Database.call(this);

	/* Install the db. */

	this._conf = conf;
	this._couchClient = couchdb.createClient(conf.port, conf.hostname);
	this._db = this._couchClient.db(conf.dbName);

	this.dbInstall();
	return this;
}
inherits(CouchDatabase, db.Database); 

CouchDatabase.prototype.dbInstall = function(){
	var cdb = this._db;
	var _this = this;
	/* Count number of views to save. */
	var count = 0;
	for(x in _Views)
		++count;

	cdb.create(function(err, res){
		if(err && err.error != "file_exists"){
			_this.emit("init", err);
			return;
		}

		var returned = 0;
		for(x in _Views){
			cdb.saveDesign(x, _Views[x],
				function(err, res) {
					if(err){
						sys.puts("Error with view " + JSON.stringify(err));
					}
					else{
						sys.puts("Saved view " + x + " " + JSON.stringify(res));
					}

					/* When all views installed emit "init" event. */
					++returned;
					if(count == returned)
						_this.emit("init");
				}
			);
		}
	});
}

CouchDatabase.prototype.createRoutine = function(routine, cb){
  this._db.saveDoc(routine, function(err, data){
		if(err){
			cb(err);
			return;
		}

		/* Assign rootid. */
		routine.rootID = data.id;
		routine._id = data.id;
		routine._rev = data.rev;
		cb(null, routine);
	});
}

CouchDatabase.prototype.appendRoutine = function(rootID, routine, cb){
	throw new Error("Unimplemented!");
}

CouchDatabase.prototype.recTaskEvent = function(routineID, taskTime, data, cb){
	data.routineID = routineID;
	data.taskTime = taskTime;
  this._db.saveDoc(data, function(err, d){
		cb(err);
	});
}

CouchDatabase.prototype.getSchedule = function(cb){
	var _this = this;
  _this._db.view("scheddesk", "schedule",
    {
			"reduce":true,
			"group":true,
			"group_level":1
    },
    function(err, res){
      if(err){
        cb(err);
				return;
			}

			/* Build list of document keys to get. */
			var list = [];
			for(var i = 0; i < res.rows.length; ++i){
				var arr = res.rows[i].value;
				var latest = arr[arr.length - 1];
				list.push(latest);
			}

			/* Retrieve the documents. */
  		_this._db.getMultipleDocs(list, function(err, res){
				if(err){
					cb(err);
					return;
				}

				/* Return map of jobs. */
				var ret = {};
				for(var i = 0; i < res.rows.length; ++i)
					ret[res.rows[i].key] = res.rows[i].doc;

				cb(null, ret);
			});
		}
	);

}

CouchDatabase.prototype.getRoutine = function(rootID, cb){
	var _this = this;
	_this._db.view("scheddesk", "schedule",
		{
			"startkey": rootID,
			"endkey": rootID + "\u9999",
			"reduce":true
		},
		function(err, res){
			if(err){
				cb(err);
				return;
			}

			/* Expecting exactly one result.  */
			if(res.rows.length != 1){
				cb(new Database.Error("Multiple rootID entries!"));
				return;
			}

			/* Grab all revisions */
			_this._db.getMultipleDocs(res.rows[0].value, function(err, res){
				if(err){
					cb(err);
					return;
				}

				/* Return list. */
				var ret = [];
				for(var i = 0; i < res.rows.length; ++i)
					ret[i] = res.rows[i].doc;

				cb(null, ret);
			});
		}
	);
}

CouchDatabase.prototype.getAdHocs = function(cb){
	/* FIXME */
	cb(null, []);
}


exports.CouchDatabase = CouchDatabase;
