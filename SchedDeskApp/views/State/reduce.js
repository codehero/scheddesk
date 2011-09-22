function (key, values, rereduce){
	if(!rereduce){
		var m = 0;
		var latest = -Infinity;
		var id = values[0]._id;
		for(var i = 0; i < values.length; ++i){
			m ^= values[i].mask;
			if(latest < values[i].ts)
				latest = values[i].ts;
		}
		return {"mask":m, "ts":latest, "_id":id};
	}
}
