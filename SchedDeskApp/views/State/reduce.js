function (key, values, rereduce){
	var m = 0;
	var latest = -Infinity;
	var id = null;
	for(var i = 0; i < values.length; ++i){
		m ^= values[i].mask;
		if(latest < values[i].ts){
			latest = values[i].ts;
			id = values[i]._id;
		}
	}
	return {"mask":m, "ts":latest, "_id":id};
}
