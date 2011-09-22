function(doc){

	/* All dequeue events are native scheddesk documents. */
	var parts = doc._id.split(".");
	if(parts.length > 2 && parts[0] == "scheddesk"){
		if(parts[1] == "dequeue"){
			emit([doc.timestamp, doc.triggerID], {"_id":doc._id});
			return;
		}
		else if(parts[1] == "retry"){
			emit([doc.timestamp, doc.triggerID], {"_id":doc._id});
			return;
		}
		else if(parts[1] == "termination"){
			emit([doc.timestamp, doc.triggerID], {"_id":doc._id});
		}
	}

	/* All enqueue/completed events contain schedesk attributes. */
	if("scheddesk_trigger" in doc){
		emit([doc.scheddesk_trigger.timestamp, doc._id], {"_id":doc._id});
	}

	/* All enqueue/completed events contain schedesk attributes. */
	if("scheddesk_err_report" in doc){
		emit([doc.scheddesk_err_report.timestamp, doc.scheddesk_err_report.triggerID], {"_id":doc._id});
	}

}
