global glob

on viewTileSize
  w = the stageRight - the stageLeft
  h = the stageBottom - the stageTop
  return [12 + ((w - 610 + 49) / 50), 9 + ((h - 440 + 49) / 50)]
end

on viewCenter
  return point((the stageRight - the stageLeft) / 2, (the stageBottom - the stageTop) / 2)
end
