"""
URL configuration for cam_blindspot project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.urls import path

from blindspot import views

urlpatterns = [
    path('', views.index, name='index'),
    path('api/health', views.health, name='health'),
    path('api/regions', views.regions, name='regions'),
    path('api/regions/<int:region_id>/import-buildings', views.import_buildings, name='import-buildings'),
    path('api/regions/<int:region_id>/scenarios', views.scenarios, name='scenarios'),
    path('api/regions/<int:region_id>/scenarios/upload-csv', views.upload_csv, name='upload-csv'),
    path('api/regions/<int:region_id>/optimize', views.optimize, name='optimize'),
    path('api/regions/<int:region_id>/buildings', views.buildings, name='buildings'),
    path('api/scenarios/<int:scenario_id>', views.scenario, name='scenario'),
    path('api/scenarios/<int:scenario_id>/analyze', views.analyze, name='analyze'),
]
