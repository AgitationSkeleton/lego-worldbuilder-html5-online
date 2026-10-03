property pTarget, pSprite, pMember
global glob

on beginSprite me
  pSprite = sprite(me.spriteNum)
  pMember = pSprite.member.name
end

on mouseEnter me
  o = member(pMember & "_rollover")
  if o.memberNum > 0 then
    pSprite.member = o
  end if
end

on mouseLeave me
  pSprite.member = pMember
end

on mouseDown me
  o = member(pMember & "_press")
  if o.memberNum > 0 then
    pSprite.member = o
  end if
end

-- (the target "main menu" is the page's main menu, showMainMenu(), src/main.js)
on mouseUp me
  pSprite.member = pMember
  SndSFX("sfx_interface_click_button")
  if pTarget = "main menu" then
    showMainMenu()
  else
    go(pTarget)
  end if
end
