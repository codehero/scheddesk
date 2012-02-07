function(doc){

	/* All dequeue events are native scheddesk documents. */
	var parts = doc._id.split(".");
	if(parts.length > 2 && parts[0] == "scheddesk"){
		if(parts[1] == "dequeue"){
			emit(doc.triggerID, {"mask":0x2, "ts":doc.timestamp,"_id":doc._id});
			return;
		}
		else if(parts[1] == "termination"){
			emit(doc.triggerID, {"mask":0x8, "ts":doc.timestamp, "_id":doc._id});

			if("scheddesk_retry" in doc){
				/* Cancel out the dequeue. */
				emit(doc.scheddesk_retry.triggerID,
					{"mask":0x2, "ts":doc.timestamp, "_id":doc._id});
			}
		}
	}

	/* All enqueue/completed events contain schedesk attributes. */
	if("scheddesk_trigger" in doc){
		emit(doc._id, {"mask":0x1, "ts":doc.scheddesk_trigger.scheduledTime, "_id":doc._id});
	}

	/* All enqueue/completed events contain schedesk attributes. */
	if("scheddesk_err_report" in doc){
		emit(doc.scheddesk_err_report.triggerID,
			{
				"mask":0x4,
				"ts":doc.scheddesk_err_report.timestamp,
				"_id":doc._id
			});
	}

}
