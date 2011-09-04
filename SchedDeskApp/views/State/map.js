function(doc){

	/* All dequeue events are native scheddesk documents. */
	var parts = doc._id.split(".");
	if(parts.length > 2 && parts[0] == "scheddesk"){
		if(parts[1] == "dequeue" && null == doc.retryTime){
			emit(doc.triggerID, {"mask":0x2, "ts":doc.timestamp,"_id":doc.triggerID});
			return;
		}
		else if(parts[1] == "termination"){
			emit(doc.triggerID, {"mask":0x4, "ts":doc.timestamp, "_id":doc.triggerID});
		}
	}

	/* All enqueue/completed events contain schedesk attributes. */
	if("scheddesk_trigger" in doc){
		emit(doc._id, {"mask":0x1, "ts":doc.scheddesk_trigger.scheduledTime, "_id":doc._id});
	}
}
