function (doc){
	var parts = doc._id.split(".");
	if(parts.length < 3)
		return;
	if(parts[0] != "scheddesk" || parts[1] != "routine")
		return;

	/* Key identifies if this routine is active or inactive. */
	emit(doc.active ? 1 : 0, {"_id":doc._id});
}
