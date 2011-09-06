function(doc){
	var parts = doc._id.split(".");
	if(parts.length > 2 && parts[0] == "scheddesk" && parts[1] == "taskDefinition"){
		emit(doc.name, null);
	}
}
