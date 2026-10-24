import AppKit
let output = CommandLine.arguments[1]
let size = 1024.0
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
func fill(_ r: CGRect, _ color: NSColor, radius: CGFloat) {
    color.setFill(); NSBezierPath(roundedRect: r, xRadius: radius, yRadius: radius).fill()
}
fill(CGRect(x:0,y:0,width:size,height:size),NSColor(red:0.95,green:0.96,blue:0.90,alpha:1),radius:0)
fill(CGRect(x:105,y:300,width:410,height:460),NSColor(red:0.22,green:0.52,blue:0.86,alpha:1),radius:100)
fill(CGRect(x:500,y:285,width:410,height:440),NSColor(red:0.98,green:0.71,blue:0.20,alpha:1),radius:175)
let ink = NSColor(red:0.06,green:0.19,blue:0.27,alpha:1)
for x in [220.0,390,610,775] {
    let y = x < 500 ? 540.0 : 510.0
    fill(CGRect(x:x-37,y:y-40,width:74,height:80),.white,radius:37)
    fill(CGRect(x:x-12,y:y-17,width:25,height:39),ink,radius:13)
    if x < 500 {
        ink.setStroke();let ring=NSBezierPath(ovalIn:CGRect(x:x-58,y:y-60,width:116,height:120));ring.lineWidth=13;ring.stroke()
    }
}
ink.setStroke();let bar=NSBezierPath();bar.move(to:CGPoint(x:278,y:540));bar.line(to:CGPoint(x:332,y:540));bar.lineWidth=13;bar.stroke()
fill(CGRect(x:840,y:392,width:51,height:134),NSColor(red:0.06,green:0.53,blue:0.48,alpha:1),radius:22)
fill(CGRect(x:394,y:280,width:120,height:157),.white,radius:14)
fill(CGRect(x:394,y:280,width:15,height:157),ink,radius:5)
for x in [280.0,685]{fill(CGRect(x:x-28,y:430,width:56,height:13),ink,radius:7)}
// The shared balance motif anchors the duo's workshop identity.
fill(CGRect(x:248,y:187,width:530,height:22),ink,radius:11)
let triangle=NSBezierPath();triangle.move(to:CGPoint(x:514,y:215));triangle.line(to:CGPoint(x:466,y:132));triangle.line(to:CGPoint(x:562,y:132));triangle.close();ink.setFill();triangle.fill()
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:output))
