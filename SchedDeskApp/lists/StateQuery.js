function(head, req){
	var r;

	/* Make sure that the params are defined. */
	if(!("op" in req.query))
		throw new Error("No operation defined!");

	if(!("maskValue" in req.query))
		throw new Error("No mask value defined!");

	var op = req.query.op;
	var maskValue = parseInt(req.query.maskValue, 16);
	if(isNaN(maskValue))
		throw new Error("Mask value is not hex integer!");

	send("[");

	var resCount = 0;
	while(r = getRow()){

		if(op == "lt" && r.value.mask < maskValue){
			if(resCount)
				send(",");

			send(JSON.stringify(r.value));
			++resCount;
		}
		else if(op == "eq" && r.value.mask == maskValue){
			if(resCount)
				send(",");

			send(JSON.stringify(r.value));
			++resCount;
		}
	}

	send("]");
}
