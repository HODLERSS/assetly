import subprocess, numpy as np, json, sys
V=sys.argv[1]; W,H=1080,1920
p=subprocess.Popen(["ffmpeg","-v","error","-i",V,"-f","rawvideo","-pix_fmt","rgb24","-"],stdout=subprocess.PIPE)
res=[]; i=0
while True:
    b=p.stdout.read(W*H*3)
    if len(b)<W*H*3: break
    a=np.frombuffer(b,np.uint8).reshape(H,W,3).astype(np.int16).sum(2)
    row=a[1500]; br=np.where(row>250)[0]
    if not len(br): res.append((i/60,-1,-1,-1,-1)); i+=1; continue
    xL,xR=int(br[0]),int(br[-1])
    # the left rim: a bright run in columns xL..xL+3; walk UP from y=1500 while the rim stays bright
    rim=a[:, xL:xL+4].max(1) > 200
    y=1500
    while y>200 and rim[y-1]: y-=1
    # tolerate 1-2 px gaps
    while y>200 and (rim[y-2] or rim[y-3]) and not rim[y-1]:
        y-=1
        while y>200 and rim[y-1]: y-=1
    # top rim (if visible): scan the column 12% in for the first bright pixel between y-200 and y
    xc=int(xL+0.12*(xR-xL)); col=a[max(200,y-260):y, xc]; hit=np.where(col>250)[0]
    top=int(max(200,y-260)+hit[0]) if len(hit) else -1
    res.append((i/60,xL,xR,y,top)); i+=1
json.dump(res,open("meas2.json","w"))
