/*
TODO/FEATURES

copy SVG to clipboard
end cap style?
alignment? left right ... center?

force upper case/lowercase?
color?

some effects?
pull effects and sample text out into another 'dev panel'

XXXXXXadd in name option when exporting/downloading

XXXXXXhave buttons for sample text
XXXXXXfont size base 60 tall 20 - 120
XXXXXXword wrap + word wrap distance
XXXXXXauto update on change?
*/




var FONTS_PATH="fonts/";
var FONT_PATHS=["sutton.js", "nassau.js", "kosciuszko.js"];
var FONT_DATA=[];

var CURRENT_FONT_ID=0;

var specimen = "ABCDEFGHIJ\n"+
				"KLMNOPQRS\n"+
				"TUVWXYZ\n"+
				"abcdefghij\n"+
				"klmnopqrs\n"+
				"tuvwxyz\n"+
				"0123456789\n"+
				"~!?.,<>:;'\"\n"+
				"[]{}\\/|+=-*_-";

var textSamples =[];

//UI EVENTS
/**************************************/
$( "#export" ).click(function() {
	var fileName = $("#text-field").val();
	fileName = fileName.trim();
	fileName = fileName.substr(0, 12);
	//replace whitespace with underscores
	fileName = fileName.replace(/[\s]/g,"_");
	fileName = fileName.replace(/[^a-zA-Z\d_]/g,"");
	console.log("fileName " + fileName);
	downloadSVG(fileName);
});
$( "#build" ).click(function() {
  buildText();
});

$( "#font-select" ).change(function() {
  	CURRENT_FONT_ID = $( this ).val();
  	resetRenderSettings();
});

$( "#font-scale" ).change(function() {
  $( "#font-scale" ).val( clamp( $( "#font-scale" ).val(), .333, 2) );
});

$("#text-field").on('input',function(e){
	if($("#text-field").val().length > 600){
		$("#build").addClass("show");
		return;
	}
	$("#build").removeClass("show");
	buildText();
});

$(".build-on-change").change(function(){
	// console.log("change");
	buildText();
});


$(window).bind('keydown', function(event) {
	console.log('key');
	if (event.ctrlKey) {
		switch (String.fromCharCode(event.which).toLowerCase()) {
			case 'd':
			$( "#dev-samples" ).toggleClass("show");
			break;
		}
	}
});

$( "#sample-select" ).change(function() {
  	var sample = $( this ).val();
  	if(textSamples[sample] !=null){
  		$("#text-field").val(textSamples[sample]);
  	}
  	buildText();
  	//resetRenderSettings();
});

function getRenderSettings(){
	//get the render settings from the form
	var settings={
		strokeCap: $( '#cap-select' ).val(),
		strokeWeight: Number($( '#stroke-weight' ).val()),
		fontSize: Number($( '#font-scale' ).val()),
		wordWrap: $( '#word-wrap-toggle' ).prop('checked'),
		wordWrapWidth: Number($( '#word-wrap-width' ).val()),
		letterSpacing: Number($( '#letter-spacing' ).val()),
		lineHeight: Number($( '#line-height' ).val()),
		monospace: $( '#monospace' ).prop('checked'),
		spacingBase: Number($( '#spacing-base' ).val()),
	};
	return settings;
}

function resetRenderSettings(){
	//this is called when the font is changed
	//use the default settings from the font file
	var font = FONT_DATA[CURRENT_FONT_ID];
	$( '#letter-spacing' ).val(font.baseLetterSpacing);
	$( '#line-height' ).val(font.baseLineHeight);
	$( '#monospace' ).prop('checked', font.monospaced);
	$( '#spacing-base' ).val(font.baseLetterSpaceUnit);
}

//DRAWING FONTS
/**************************************/
function renderType(stringText){
	var renderSettings=getRenderSettings();
	var margin = 10;
	var xPos=margin;
	var yPos=margin;
	
	var wordGroup;
	var scale = clamp(renderSettings.fontSize, .33, 2);
	for(var i=0; i<stringText.length; i++){
		if(stringText[i] == " "){
			if(monospace){
				xPos += renderSettings.letterSpacing;
			}else{
				xPos += renderSettings.letterSpacing + (fontSpacingBase*2);
			}
			wordGroup = null;

			if(renderSettings.wordWrap && xPos > renderSettings.wordWrapWidth/scale){
				xPos = margin;
				yPos += renderSettings.lineHeight;
			}
		}else if(stringText[i] == "\n"){

			xPos = margin;
			yPos += renderSettings.lineHeight;
			wordGroup = null;
		}else if(stringText[i] == "\t"){
			//tab is equal to 4 spaces?
			if(monospace){
				xPos += renderSettings.letterSpacing*4;
			}else{
				xPos += (renderSettings.letterSpacing*4) + (fontSpacingBase*2);
			}
			wordGroup = null;

		}else{
			if(wordGroup==null){
				wordGroup = new Group();
			}
			

			var charLayer = getCharacterGroup(stringText[i]);
			if(charLayer==null){
				console.log("Error character not found: " + stringText[i]);
				continue;
			}
			var offset = charLayer.bounds.center;
			var copy = charLayer.clone();
			copy.visible=true;
			console.log(renderSettings.strokeCap);
			if(renderSettings.strokeCap != 'default'){
				copy.strokeCap = renderSettings.strokeCap;
			}
			copy.strokeWidth = renderSettings.strokeWeight;
			wordGroup.addChild(copy);

			if(renderSettings.monospace){
				copy.position = new Point(xPos + offset.x, yPos + offset.y);
				xPos += renderSettings.letterSpacing;
			}else{
				var sideBearing = getCharSideBearing(stringText[i]);
				//add the left side bearing
				xPos += sideBearing[0] * renderSettings.spacingBase;
				//position the letter
				copy.position = new Point(xPos + offset.x, yPos + offset.y);
				//add the width of the letter
				xPos += copy.bounds.width;
				//add the right side bearing
				xPos += sideBearing[1] * renderSettings.spacingBase;
			}

			effects(copy);
		}
	}
	//scale the type
	project.activeLayer.scale(scale, new Point(0, 0));
}

function clamp(val, min, max){
	if(val<min) return min;
	if(val>max) return max;
	return val;
}

function getCharacterGroup(character){
	var charData = characterMap[character];
	if(charData==null){
		console.log("Error Character Not Mapped: " + character);
		return null;
	}
	return FONT_DATA[CURRENT_FONT_ID].paperSymbols.children['char-' + charData.name];
}

function getCharSideBearing(_char){
    //return side bearing values
    var fontLetterSpacing = FONT_DATA[CURRENT_FONT_ID].charLetterSpacing;

    if(fontLetterSpacing[_char] && fontLetterSpacing[_char].sidebearing){
        return fontLetterSpacing[_char].sidebearing;
    }

    // $.writeln("No spacing info found: " + _char);
    return [0,0];
}

function reset(){
	project.clear();
}

function buildText(){
	reset();
	renderType($('#text-field').val());
}

//LOADING & SAVING
/**************************************/
function loadFontData(id){
	//if (typeof someObject == 'undefined') 
	$.loadScript(FONTS_PATH + FONT_PATHS[id], function(){	
		console.log('font data loaded');
		FONT_DATA[id] = data;
		loadFontSVG(id);
	});
}

function loadFontSVG(id){
	//get the font file param
	var options={
		onLoad:function(item){
			console.log('svg loaded');
			FONT_DATA[id].paperSymbols = item;
		},
		insert:false,
		expandShapes:true,
	};
	paper.project.importSVG(FONTS_PATH + FONT_DATA[id].file, options);
}

function downloadSVG(fileName){
	paper.project.exportSVG();

   if(!fileName) {
       fileName = "gf_000.svg"
   }

   var url = "data:image/svg+xml;utf8," + encodeURIComponent(paper.project.exportSVG({asString:true}));

   var link = document.createElement("a");
   link.download = fileName;
   link.href = url;
   link.click();
}

//UTILS
/**************************************/
jQuery.loadScript = function (url, callback) {
    jQuery.ajax({
        url: url,
        dataType: 'script',
        success: callback,
        async: true
    });
}

//get all the segements in an item
function allSegments(item, recursive){
	if(recursive>4) return; // stop it at 4 deep
	var segments=[];
	
	if(item.segments !=null && item.segments.length>0){
		segments = segments.concat(item.segments);
	}

	//dig down into children
	if(item.hasChildren()){
		for (var c=0; c < item.children.length; c++) {
			var childSegments = allSegments(item.children[c], recursive+1);
			if(childSegments !=null && childSegments.length>0){
				segments = segments.concat(childSegments);
			}
		}
	}

	return segments;
}
function allCurves(item, recursive){
	if(recursive>4) return; // stop it at 4 deep
	var curves=[];
	
	if(item.curves !=null && item.curves.length>0){
		curves = curves.concat(item.curves);
	}

	//dig down into children
	if(item.hasChildren()){
		for (var c=0; c < item.children.length; c++) {
			var childcurves = allCurves(item.children[c], recursive+1);
			if(childcurves !=null && childcurves.length>0){
				curves = curves.concat(childcurves);
			}
		}
	}

	return curves;
}


//SPECIAL EFFECTS
/**************************************/
function effects(item){
	// drawSegments(item);
	// doStuffToCurves(item);
}
function doStuffToCurves(item){
	var curves = allCurves(item, 0);
	for(var i = 0; i< curves.length; i++){
		// if(curves[i].isStraight()){
		// 	curves[i].path.style.strokeWidth = 10;
		// }
		//draw line that is tangent
		var curve = curves[i];
		

		stepCurves(curve, 5);
	}
}
function stepCurves(curve, steps){
	for(var s=1/steps; s<1; s+=1/steps){
		var tan = curve.getNormalAtTime(s);
		var p1 = curve.getPointAtTime(s);
		var p = Path.Line(p1-(tan * 10), p1+(tan * 10));
		p.strokeColor = 'red'
		p.strokeWidth = 1;
	}
}

function drawSegments(item){
	
	var segments = allSegments(item, 0);

	for(var i = 0; i< segments.length; i++){
		var dot = new Shape.Circle(segments[i].point, 3);
		dot.fillColor = 'red';
		item.addChild(dot);
		// segments[i].path.style.strokeWidth = Math.random()*8;
	}
}




//SETUP + INIT
/**************************************/
function init(){
	//load in the fonts
	loadFontData(0);
	loadFontData(1);
	loadFontData(2);
	//specimen
	$('#text-field').val(specimen);
}

//wait until everything is loaded
function initRun(){
	// console.log('go', FONT_DATA[0].paperSymbols);
	reset();
	resetRenderSettings();
	buildText();
}

init();
setTimeout(initRun, 1000);

var characterMap = {
    "a":{name:"a", layer:null},
    "b":{name:"b", layer:null},
    "c":{name:"c", layer:null},
    "d":{name:"d", layer:null},
    "e":{name:"e", layer:null},
    "f":{name:"f", layer:null},
    "g":{name:"g", layer:null},
    "h":{name:"h", layer:null},
    "i":{name:"i", layer:null},
    "j":{name:"j", layer:null},
    "k":{name:"k", layer:null},
    "l":{name:"l", layer:null},
    "m":{name:"m", layer:null},
    "n":{name:"n", layer:null},
    "o":{name:"o", layer:null},
    "p":{name:"p", layer:null},
    "q":{name:"q", layer:null},
    "r":{name:"r", layer:null},
    "s":{name:"s", layer:null},
    "t":{name:"t", layer:null},
    "u":{name:"u", layer:null},
    "v":{name:"v", layer:null},
    "w":{name:"w", layer:null},
    "x":{name:"x", layer:null},
    "y":{name:"y", layer:null},
    "z":{name:"z", layer:null},
    "A":{name:"A", layer:null},
    "B":{name:"B", layer:null},
    "C":{name:"C", layer:null},
    "D":{name:"D", layer:null},
    "E":{name:"E", layer:null},
    "F":{name:"F", layer:null},
    "G":{name:"G", layer:null},
    "H":{name:"H", layer:null},
    "I":{name:"I", layer:null},
    "J":{name:"J", layer:null},
    "K":{name:"K", layer:null},
    "L":{name:"L", layer:null},
    "M":{name:"M", layer:null},
    "N":{name:"N", layer:null},
    "O":{name:"O", layer:null},
    "P":{name:"P", layer:null},
    "Q":{name:"Q", layer:null},
    "R":{name:"R", layer:null},
    "S":{name:"S", layer:null},
    "T":{name:"T", layer:null},
    "U":{name:"U", layer:null},
    "V":{name:"V", layer:null},
    "W":{name:"W", layer:null},
    "X":{name:"X", layer:null},
    "Y":{name:"Y", layer:null},
    "Z":{name:"Z", layer:null},
    "0":{name:"0", layer:null},
    "1":{name:"1", layer:null},
    "2":{name:"2", layer:null},
    "3":{name:"3", layer:null},
    "4":{name:"4", layer:null},
    "5":{name:"5", layer:null},
    "6":{name:"6", layer:null},
    "7":{name:"7", layer:null},
    "8":{name:"8", layer:null},
    "9":{name:"9", layer:null},
    "-":{name:"dash", layer:null},
    "—":{name:"dash", layer:null},
    "_":{name:"underscore", layer:null},
    '"':{name:"doublequote", layer:null},
    "“":{name:"doublequote", layer:null},
    "”":{name:"doublequote", layer:null},
    "'":{name:"quote", layer:null},
    "’":{name:"quote", layer:null},
    ",":{name:"comma", layer:null},
    "~":{name:"tilde", layer:null},
    ":":{name:"colon", layer:null},
    ";":{name:"semicolon", layer:null},
    "?":{name:"question", layer:null},
    ".":{name:"period", layer:null},
    "!":{name:"exclamation", layer:null},
    "&":{name:"ampersand", layer:null},
    "#":{name:"pound", layer:null},
    "|":{name:"bar", layer:null},
    "\\":{name:"backslash", layer:null},
    "/":{name:"slash", layer:null},
    ")":{name:"parenthright", layer:null},
    "(":{name:"parenthleft", layer:null},
    "%":{name:"percent", layer:null},
    ">":{name:"greaterthan", layer:null},
    "<":{name:"lessthan", layer:null},
    "}":{name:"curlyright", layer:null},
    "{":{name:"curlyleft", layer:null},
    "]":{name:"bracketright", layer:null},
    "[":{name:"bracketleft", layer:null},
    "^":{name:"caret", layer:null},
    "@":{name:"at", layer:null},
    "$":{name:"dollar", layer:null},
    "=":{name:"equal", layer:null},
    "+":{name:"plus", layer:null},
    "*":{name:"asterix", layer:null}
}

//SAMPLE CONTENT DEFINITIONS
/**************************************/


textSamples.icaps = "Aaron Able Ache Advert\n" +
"Aegis Aft Age Ahe Ails \n" +
"Ajar Akin Aloe Amish And \n" +
"Aone Ape Aqua Are Ascot \n" +
"Atlas Auto Avon Awe Axe \n" +
"Aye Azo \n" +
"Band Bet Bing Bloat Bog \n" + 
"Bring Bumpy \n" + 
"Carry Celar Cinthia Cope Crap \n" + 
"Cult Cycle \n" + 
"Dark Demon Dingy Dope Dumb \n" + 
"Each Eels Einar Eons Euchre \n" + 
"Ever Ewer Exit Eyes \n" + 
"Fact Fever Fire Fıne Font Framer \n" + 
"Fur Fyrd Folder Funk \n" + 
"Gayle Gentle Girl Gnome \n" + 
"Gonot Grinning Gulf Gwen Gyro \n" + 
"Harder Help Hilton Honor Hunk Hymn \n" + 
"Ian Ieo Iggy Iillian Ion Iugia Iyaaa \n" + 
"Jacky Jester Jimmy Joint Junk  \n" + 
"Kangaroo Keep Kill Kline";

//*
textSamples.lowercase = "stop go pluck wane wax exit dance cycle duck drake dole \
nice welcome lawyer lance layer music muscle mail meal mode myth \
mist many much how do you yack off fill kick llama Lima \
ask answer amazon aft aquaaegis avon are cope crap cult \
truck tractor tail them royalputt quest typing tap thumbs \
utter fat jack just in timejail jerk bjork baja kluje major \
mujher jury journal joust jotter jitter ajax ancient animal \
zam zim zebra";

textSamples.kerningPairs1 = "AG AC AJ AO AQ AU AV AW AY AT AP \
GG GC GJ GO GQ GU GV GW GY GT GP \
CG CC CJ CO CQ CU CV CW CY CT CP \
JG JC JJ JO JQ JU JV JW JY JT JP \
OG OC OJ OO OQ OU OV OW OY OT OP \
QG QC QJ QO QQ QU QV QW QY QT QP \
UG UC UJ UO UQ UU UV UW UY UT UP \
VG VC VJ VO VQ VU VV VW VY VT VP \
WG WC WJ WO WQ WU WV WW WY WT WP \
YG YC YJ YO YQ YU YV YW YY YT YP \
PG PC PJ PO PQ PU PV PW PY PT PP PA \
TG TC TJ TO TQ TU TV TW TY TT TS TP \
EZ EI ET EY EJ \
FZ FI FT FY FJ \
TL TE TJ TZ QT QZ";

textSamples.kerningPairs2 = "ag ac aj ao aq au av aw ay at ap gg gc gj go gq gu gv gw gy gt gp \
cg cc cj co cq cu cv cw cy ct cp jg jc jj jo jq ju jv jw jy jt jp \
og oc oj oo oq ou ov ow oy ot op qg qc qj qo qq qu qv qw qy qt qp \
ug uc uj uo uq uu uv uw uy ut up \
vg vc vj vo vq vu vv vw vy vt vp \
wg wc wj wo wq wu wv ww wy wt wp \
yg yc yj yo yq yu yv yw yy yt yp \
pg pc pj po pq pu pv pw py pt pp pa \
tg tc tj to tq tu tv tw ty tt ts tp \
ez ei et ey ej \
fz fi ft fy fj \
tl te tj tz \
qt qz";

textSamples.read1 = "Technology’s new rules (link in Chinese) could, if they were enforced as written, essentially shut down China as a market for foreign news outlets, publishers, gaming companies, information providers, and entertainment companies starting on March 10. Issued in conjunction with the State Administration of Press, Publication, Radio, Film and Television (SARFT), they set strict new guidelines for what can be published online, and how that publisher should conduct business in China.";
textSamples.read2 = "Facebook are clamoring to get in—all drawn by the country’s massive online population, estimated at nearly 700 million people. But the new rules would allow only 100% Chinese companies to produce\
“SARFT has many duties, but with respect to the internet its main task is to regulate online audio and video content, which includes administering the ‘License for Publication of Audio-Visual Programs Through Information Networks,” (link in Chinese) he said. MIIT, the regulation’s other drafter, “is the nation’s principal internet regulator and the primary body responsible for licensing and registering Chinese websites.”";
//*/