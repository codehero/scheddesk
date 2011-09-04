function(head, req){
	var r;
	send("[");
	var rowCount = 0;
	while(r = getRow()){
		if(rowCount)
			send(",");
		send(JSON.stringify(r.value));
	}
	send("]");
}
