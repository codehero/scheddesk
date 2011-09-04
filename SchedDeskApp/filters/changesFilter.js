function(doc, req) {
	var parts = doc._id.split(".");
	if(parts[0] == "scheddesk")
		return true;
  
	/* Assume that an item could have been enqueued or task terminated
	 * if the following fields exist in these updates. */
	if("scheddesk_trigger" in doc)
		return true;
	if("scheddesk_terminated" in doc)
		return true;
	
	return false;
}
