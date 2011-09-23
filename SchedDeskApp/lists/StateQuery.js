function(head, req){
	var r;

	/* Make sure that the params are defined. */
	if(!("op" in req.query))
		throw new Error("No operation defined!");

	if(!("maskValue" in req.query))
		throw new Error("No mask value defined!");

	var preMask =
		("preMask" in req.query) ? parseInt(req.query.preMask, 16) : 0xFFFF;

	var op = req.query.op;
	var maskValue = parseInt(req.query.maskValue, 16);
	if(isNaN(maskValue))
		throw new Error("Mask value is not hex integer!");

	send("[");

	var resCount = 0;
	while(r = getRow()){

		var v = r.value.mask & preMask;
		if(op == "lt" && v < maskValue){
		}
		else if(op == "eq" && v == maskValue){
		}
		else
			continue;

		if(resCount)
			send(",");
		send(JSON.stringify(r));
		++resCount;
	}

	send("]");
}
