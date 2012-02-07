function (newDoc, savedDoc, userCtx){
	/* Just let deletions go through */
	if(newDoc._deleted)
		return;

	var parts = newDoc._id.split(".");

	function require(field){
		if(!(field in newDoc))
			throw({"forbidden":"Missing field: "+ field +"!"});
	}

	/* If id contains scheddesk, the native scheddesk object. */
	if(parts[0] == "scheddesk"){

		/* Expect 3 parts for each object. */
		if(parts.length < 3)
			throw({"forbidden":"Invalid scheddesk key!"});

		switch(parts[1]){
			case "routine":

				/* Make sure required fields are present. */
				require("taskID");
				if(savedDoc){
					if(newDoc.taskID != savedDoc.taskID)
						throw({"forbidden":"Cannot changed taskID!"});
				}
				require("name");
				require("interval");
				require("period");
				require("active");

				/* Make sure interval field contains only two non-negative values,
				 * in ascending order. */
				var interval = newDoc.interval;
				/* FIXME WTF doesn't this work here?! */
				//if(!(interval instanceof Array))
				//	throw({"forbidden":"Interval must be an array!"});
					
				if(interval.length != 2)
					throw({"forbidden":"Interval must contain only 2 elements!"});

				if(isNaN(interval[0]) || isNaN(interval[1])
					|| interval[0] < 0 || interval[1] < 0)
				{
					throw({"forbidden":"Interval numbers must be nonnegative integers!"});
				}
				if(interval[0] > interval[1])
					throw({"forbidden":"First interval must be < second!"});

				/* Check active. */
				if(typeof newDoc.active != "boolean")
					throw({"forbidden":".active must be boolean!"});

				/* Check validity of period. */
				if(typeof newDoc.period != "object" || null == newDoc.period)
					throw({"forbidden":".period must be an object map!"});

				/* Period must define magnitude. */
				if(isNaN(newDoc.period.magnitude) || newDoc.period.magnitude <= 0)
					throw({"forbidden":".period.magnitude  must be > 0!"});

				/* Check for valid units. */
				var valueLength = 0;
				switch(newDoc.period.units){
					case "seconds":
						if("time" in newDoc.period)
							throw({"forbidden":"Periods with units seconds do not have a time field!"});
						break;

					case "days":
						valueLength = 3;
						break;

					case "months":
						valueLength = 4;
						break;

					case "years":
						valueLength = 5;
						break;

					default:
						throw({"forbidden":"Invalid .period.units specification!"});
				}

				/* Non-seconds units require time values. */
				if(valueLength){
					/* Check isClock. */
					if(typeof newDoc.period.time.isClock != "boolean")
						throw({"forbidden":".period.time.isClock must be boolean!"});

					var v = newDoc.period.time.value;
					//if(!(v instanceof Array))
					//	throw({"forbidden":"period.time.value is not an array!"});
					if(v.length != valueLength)
						throw({"forbidden":"period.time.value has incorrect length!"});

					/* Check seconds, minutes. */
					if(v[0] < 0 || v[0] > 59)
						throw({"forbidden":"Invalid time value seconds!"});
					if(v[1] < 0 || v[1] > 59)
						throw({"forbidden":"Invalid time value minutes!"});

					/* Check hours, days. */
					if(newDoc.period.time.isClock){
						if(v[2] < 0 || v[2] > 23)
							throw({"forbidden":"Invalid time value hours!"});

						if(valueLength > 3){
							if(v[3] < 1 || v[3] > 28)
								throw({"forbidden":"Invalid time value day!"});
						}
					}
					else{
						/* Let users specify 23 hr offsets from begin or end of the day. */
						if(v[2] < -23 || v[2] > 23)
							throw({"forbidden":"Invalid time value hours!"});

						if(valueLength > 3){
							/* Let users configure a day a week before the end of the month */
							if(v[3] < -7 || v[3] > 28)
								throw({"forbidden":"Invalid time value day!"});
						}
					}

					/* Check month. */
					if(valueLength > 4){
						if(v[4] < 0 || v[4] > 11)
							throw({"forbidden":"Invalid time value month!"});
					}
				}
				break;

			case "taskDefinition":
				if(newDoc){
					require("name");
					require("taskType");
					require("filesTermination");
					if(newDoc.taskType ==  "child_process"){
						require("params");
						if(!newDoc.params.command)
							throw({"forbidden":"Child process must define a command!"});
					}
				}
				break;

			case "dequeue":
				if(newDoc){
					require("timestamp");
					require("triggerID");
					if(isNaN(newDoc.timestamp))
						throw({"forbidden":"Invalid dequeue timestamp!"});
				}
				break;

			case "termination":
				if(savedDoc)
					throw({"forbidden":"Cannot modify termination!"});

				if(newDoc){
					require("triggerID");
					require("timestamp");

					if(isNaN(newDoc.timestamp))
						throw({"forbidden":"No numeric timestamp in completion!"});
				}
				break;

			case "retryTrigger":
				break;

			case "manualTrigger":
				break;

			case "timedTrigger":
				break;

			case "emailConfig":
				break;

			case "forcedAbort":
			case "exitCodeError":
			case "notificationError":
				require("scheddesk_err_report");
				if(isNaN(newDoc.scheddesk_err_report.timestamp))
					throw({"forbidden":"No numeric timestamp in error!"});

				if(!("triggerID" in newDoc.scheddesk_err_report))
					throw({"forbidden":"Error does not contain triggerID!"});
				break;

			default:
				throw({"forbidden":"Unknown SchedDesk type " + parts[1] + "!"});
		}
	}

	var count = 0;

	/* Note: Objects may contain multiple tags! */

	/* Check for scheddesk tags. */
	if("scheddesk_trigger" in newDoc){
		if(savedDoc && "scheddesk_trigger" in savedDoc){
			var fields = [
				"taskDefinition",
				"timestamp",
				"scheduledTimestamp"
			];
			for(var i = 0; i < fields.length; ++i){
				if(newDoc.scheddesk_trigger[fields[i]] !=
					savedDoc.scheddesk_trigger[fields[i]])
				{
					throw({"forbidden":"Cannot change scheddesk_trigger field!"});
				}
			}
		}
		else{
			var t = newDoc.scheddesk_trigger;
			/* Triggers must refer to a taskID. */
			if(!("taskDefinition" in t))
				throw({"forbidden":"No task definition in trigger!"});

			/* Triggers must have a timestamp. */
			if(isNaN(t.timestamp))
				throw({"forbidden":"No numeric timestamp in trigger!"});

			/* Triggers must a scheduled time. */
			if(isNaN(t.scheduledTime))
				throw({"forbidden":"No numeric scheduledTime timestamp in trigger!"});
		}
	}
}
