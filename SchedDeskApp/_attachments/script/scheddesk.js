var taskStateStrings = [
	"Invalid",
	"Queued",
	"Invalid",
	"Dequeued",

	"Invalid",
	"Aborted",
	"Invalid",
	"Completed"
];

function scheddeskFormatDate(d){
	var m = (d.getMonth() + 1);
	if(m < 10)
		m = "0" + m;

	var dt = d.getDate();
	if(dt < 10)
		dt = "0" + dt;

	var h = d.getHours();
	if(h < 10)
		h = "0" + h;

	var mins = d.getHours();
	if(mins < 10)
		mins = "0" + mins;

	var s = d.getSeconds();
	if(s < 10)
		s = "0" + s;

	return d.getFullYear() +"-"+ m +"-"+ dt +" "+ h +":"+ mins +":"+ s;
}
