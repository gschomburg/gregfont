var textSamples =[];
//SAMPLE CONTENT DEFINITIONS
/**************************************/
textSamples.sk2017 ="Sketching in Hardware\n"+
"July 28th through\n"+
"August 2nd 2017\n"+
"Michigan\n"+
"Hardware\n"+
"Detroit Michigan\n"+
"Radical Hardware\n"+
"sponsors  charrette\n"+
"locations  events";


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


var FONTS_PATH = "fonts/";
var FONTS = [];          // loaded gregfont objects, in manifest order
var CURRENT_FONT_ID = 0;
var fontsReady = false;

var specimen =  "abcdefghij\n"+
				"klmnopqrs\n"+
				"tuvwxyz\n"+
				"0123456789\n"+
				"ABCDEFGHIJ\n"+
				"KLMNOPQRS\n"+
				"TUVWXYZ\n"+
				"~!?.,<>:;'\"\n"+
				"[]{}\\/|+=-*_-";


//UI EVENTS
/**************************************/
$( "#export" ).click(function() {
	var fileName = $("#text-field").val();
	fileName = fileName.trim();
	fileName = fileName.substr(0, 12);
	//replace whitespace with underscores
	fileName = fileName.replace(/[\s]/g,"_");
	fileName = fileName.replace(/[^a-zA-Z\d_]/g,"");
	downloadSVG(fileName);
});
$( "#build" ).click(function() {
	buildText();
});

$( "#font-select" ).change(function() {
	CURRENT_FONT_ID = Number($( this ).val());
	if(fontsReady) resetRenderSettings();
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
	buildText();
});

$(window).bind('keydown', function(event) {
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
});

function getRenderSettings(){
	//get the render settings from the form
	return {
		strokeCap: $( '#cap-select' ).val(),
		strokeWeight: Number($( '#stroke-weight' ).val()),
		fontSize: Number($( '#font-scale' ).val()),
		wordWrap: $( '#word-wrap-toggle' ).prop('checked'),
		wordWrapWidth: Number($( '#word-wrap-width' ).val()),
		letterSpacing: Number($( '#letter-spacing' ).val()),
		lineHeight: Number($( '#line-height' ).val()),
		monospace: $( '#monospace' ).prop('checked'),
		tracking: Number($( '#tracking' ).val()),
	};
}

function resetRenderSettings(){
	//called when the font is changed: use the font's default settings
	var spacing = FONTS[CURRENT_FONT_ID].spacing;
	$( '#letter-spacing' ).val(spacing.letterSpacing);
	$( '#line-height' ).val(spacing.lineHeight);
	$( '#monospace' ).prop('checked', spacing.monospaced);
	$( '#tracking' ).val(0);
}

//DRAWING FONTS
/**************************************/
var missingWarned = {};

function renderType(stringText){
	var s = getRenderSettings();
	var font = FONTS[CURRENT_FONT_ID];
	var layer = paper.project.activeLayer;
	var scale = clamp(s.fontSize, .333, 2);

	var result = GregFont.layout(paper, font, stringText, {
		monospace: s.monospace,
		letterSpacing: s.letterSpacing,
		lineHeight: s.lineHeight,
		tracking: s.tracking,
		wordWrap: s.wordWrap,
		wrapWidth: s.wordWrapWidth / scale,
		margin: 10
	});
	result.missing.forEach(function(ch){
		if(!missingWarned[font.name + ch]){
			console.warn(font.name + " has no glyph for: " + ch);
			missingWarned[font.name + ch] = true;
		}
	});

	var wordGroups = {};
	result.glyphs.forEach(function(placed){
		var glyph = GregFont.glyphItem(paper, font, placed.char).clone({ insert: false });
		if(s.strokeCap != 'default'){
			glyph.strokeCap = s.strokeCap;
		}
		glyph.strokeWidth = s.strokeWeight;
		glyph.translate(new paper.Point(placed.x, placed.y));

		if(!wordGroups[placed.word]){
			wordGroups[placed.word] = new paper.Group();
			layer.addChild(wordGroups[placed.word]);
		}
		wordGroups[placed.word].addChild(glyph);
		effects(glyph);
	});
	//scale the type
	layer.scale(scale, new paper.Point(0, 0));
}

function clamp(val, min, max){
	if(val<min) return min;
	if(val>max) return max;
	return val;
}

function reset(){
	paper.project.clear();
}

function buildText(){
	if(!fontsReady) return;
	reset();
	renderType($('#text-field').val());
	paper.view.draw();
}

//LOADING & SAVING
/**************************************/
function loadFonts(){
	return fetch(FONTS_PATH + "fonts.json", { cache: 'no-store' })
		.then(function(res){ return res.json(); })
		.then(function(manifest){
			return Promise.all(manifest.fonts.map(function(file){
				return GregFont.load(FONTS_PATH + file);
			}));
		});
}

function fillFontSelect(){
	var select = $("#font-select");
	var selected = Number(select.val()) || 0;
	select.empty();
	FONTS.forEach(function(font, i){
		select.append($("<option>").val(i).text(font.name.toUpperCase()));
	});
	select.val(selected < FONTS.length ? selected : 0);
}

function downloadSVG(fileName){
	if(!fileName) {
		fileName = "gf_000";
	}

	var url = "data:image/svg+xml;utf8," + encodeURIComponent(paper.project.exportSVG({asString:true}));

	var link = document.createElement("a");
	link.download = fileName + ".svg";
	link.href = url;
	link.click();
}

//UTILS
/**************************************/

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
		//draw line that is tangent
		stepCurves(curves[i], 5);
	}
}
function stepCurves(curve, steps){
	for(var s=1/steps; s<1; s+=1/steps){
		var normal = curve.getNormalAtTime(s).multiply(10);
		var p1 = curve.getPointAtTime(s);
		var p = new paper.Path.Line(p1.subtract(normal), p1.add(normal));
		p.strokeColor = 'red';
		p.strokeWidth = 1;
	}
}

function drawSegments(item){
	var segments = allSegments(item, 0);
	for(var i = 0; i< segments.length; i++){
		var dot = new paper.Shape.Circle(segments[i].point, 3);
		dot.fillColor = 'red';
		item.addChild(dot);
	}
}


//SETUP + INIT
/**************************************/
function init(){
	paper.setup(document.getElementById("fontView"));
	$('#text-field').val(specimen);

	loadFonts().then(function(fonts){
		FONTS = fonts;
		fillFontSelect();
		CURRENT_FONT_ID = Number($('#font-select').val());
		fontsReady = true;
		resetRenderSettings();
		buildText();
	}).catch(function(err){
		console.error("Failed to load fonts", err);
	});
}

init();
