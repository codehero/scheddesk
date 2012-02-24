function(head, req){
	/* Make sure that the params are defined. */
	if(!("ts" in req.query))
		throw new Error("No time specified!");
	var ts = parseInt(req.query.ts);
	if(isNaN(ts))
		throw new Error("Time must be numeric!");

	/* This function does the actual time calculation. */
	function calc(routine, now){
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
				/* Translate date to local time zone. */
				var d = new Date(now);

				var rt = routine.period.time;
				/* Can calculate in one of two ways:
				 * -Use local wall clock time
				 * -Offset the day by an absolute number of hh:mm:ss */
				if(rt.isClock){

					var dn = new Date(d.getFullYear(), d.getMonth(), d.getDate(),
						rt.value[2], rt.value[1], rt.value[0]);

					ret = dn.getTime();
				}
				else{
					var dn = new Date(d.getFullYear(), d.getMonth(), d.getDate());
					dn = dn.getTime();
					dn += (3600 * rt.value[2] + 60 * rt.value[1] + rt.value[0]) * 1000;
					ret = dn;
				}

				/* If we already missed the date, forget and it plan for the next one. */
				if(ret < now){
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

	send("[");

	var resCount = 0;
	var row;
	while(row = getRow()){
		var routine = row.doc;

		try{
			var utcTime = calc(routine, ts);
			if(utcTime < routine.interval[1]){
				if(resCount)
					send(",");
				send(JSON.stringify({
					"ts" : utcTime,
					"routine" : routine
				}));
				++resCount;
			}
		}
		catch(e){
			send(JSON.stringify(e));
		}
	}

	send("]");
}
